#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const NVIDIA_API_BASE = "https://integrate.api.nvidia.com/v1";
const MODELS = ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-nano-30b-a3b"];
const MAX_TOKENS = 16384;
const TEMPERATURE = 1.0;
const TIMEOUT_MS = 480000;
const MAX_RETRIES = 3;

const TARGET_DATE = process.env.TARGET_DATE || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const INPUT_FILE = process.env.INPUT_FILE || "papers.json";
const OUTPUT_DIR = process.env.OUTPUT_DIR || "docs";

function sanitize(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJSONParse(text) {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  try {
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeMatch) return JSON.parse(codeMatch[1]);
  } catch {}
  try {
    return JSON.parse(text);
  } catch {}
  return null;
}

async function callNvidiaAI(systemPrompt, userPrompt, apiKey) {
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.error(`[INFO] Calling ${model} (attempt ${attempt}/${MAX_RETRIES})...`);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(`${NVIDIA_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: MAX_TOKENS,
            temperature: TEMPERATURE,
            top_p: 0.95,
            stream: false,
            chat_template_kwargs: { enable_thinking: false },
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.status === 429) {
          const wait = Math.min(60000 * Math.pow(2, attempt), 120000);
          console.error(`[WARN] Rate limited on ${model}, waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(`[ERROR] ${model} returned ${res.status}: ${errText.slice(0, 200)}`);
          break;
        }
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          console.error(`[ERROR] ${model} returned empty content`);
          break;
        }
        console.error(`[INFO] ${model} responded successfully`);
        return { content, model };
      } catch (e) {
        if (e.name === "AbortError") {
          console.error(`[ERROR] ${model} timed out after ${TIMEOUT_MS / 1000}s`);
        } else {
          console.error(`[ERROR] ${model} attempt ${attempt} failed: ${e.message}`);
        }
      }
    }
  }
  return null;
}

function buildSystemPrompt() {
  return `你是延長性哀傷疾患（Prolonged Grief Disorder, PGD）領域的資深研究員和精神科醫師。
你的任務是分析最新的 PGD 相關學術文獻，產生一份專業的繁體中文日報。

你必須嚴格以 JSON 格式回應（不要使用 markdown code block），結構如下：
{
  "market_summary": "1-2 句話描述今日 PGD 文獻趨勢",
  "top_picks": [
    {
      "rank": 1,
      "title": "原文標題",
      "title_zh": "繁體中文翻譯標題",
      "journal": "期刊名稱",
      "date": "發表日期",
      "url": "PubMed 連結",
      "doi": "DOI",
      "summary_zh": "2-3 句繁體中文摘要，重點放在研究方法、主要發現和臨床意義",
      "patient_population": "研究對象（樣本數、人口學特徵）",
      "intervention": "介入或研究方法",
      "comparison": "對照組或基準",
      "outcome": "主要結果和結論",
      "clinical_utility": "high/medium/low",
      "tags": ["標籤1", "標籤2", "標籤3"]
    }
  ],
  "other_papers": [
    {
      "title": "原文標題",
      "title_zh": "繁體中文翻譯標題",
      "journal": "期刊名稱",
      "date": "發表日期",
      "url": "PubMed 連結",
      "summary_zh": "1-2 句繁體中文簡要說明"
    }
  ],
  "keywords": ["關鍵字1", "關鍵字2", "..."],
  "topic_distribution": {
    "診斷與分類": 0,
    "評估工具": 0,
    "心理治療": 0,
    "神經科學": 0,
    "流行病學": 0,
    "喪親類型": 0,
    "安寧照護": 0,
    "兒少哀傷": 0,
    "文化與社會": 0,
    "數位介入": 0
  }
}

規則：
1. top_picks 最多 8 篇，其餘放 other_papers
2. clinical_utility 只能是 high、medium 或 low
3. topic_distribution 的值是篇數，所有分類加總應等於 top_picks + other_papers 的總數
4. tags 使用繁體中文
5. 所有中文內容使用繁體中文（台灣用語）`;
}

function buildUserPrompt(papers) {
  const papersText = papers
    .map(
      (p, i) => `[${i + 1}] PMID: ${p.pmid}
Title: ${p.title}
Journal: ${p.journal}
Date: ${p.date}
DOI: ${p.doi || "N/A"}
Abstract: ${p.abstract || "No abstract available"}
Keywords: ${(p.keywords || []).join(", ") || "N/A"}
URL: ${p.url}`,
    )
    .join("\n\n");

  return `以下是今天從 PubMed 檢索到的 ${papers.length} 篇延長性哀傷疾患（PGD）相關文獻。
請仔細閱讀每篇文獻的標題和摘要，進行專業分析後，產生繁體中文日報。

${papersText}

請產生 JSON 格式的分析結果。`;
}

function generateHTML(report, date, modelUsed) {
  const topPicks = report.top_picks || [];
  const otherPapers = report.other_papers || [];
  const topicDist = report.topic_distribution || {};
  const keywords = report.keywords || [];
  const marketSummary = report.market_summary || "今日無文獻更新。";
  const totalCount = topPicks.length + otherPapers.length;

  const topPicksHTML = topPicks
    .map(
      (p) => `
      <div class="news-card featured">
        <div class="card-header">
          <span class="rank-badge">#${sanitize(p.rank)}</span>
          <div class="card-title-group">
            <h3 class="card-title">${sanitize(p.title_zh || p.title)}</h3>
            ${p.title !== p.title_zh ? `<p class="card-title-en">${sanitize(p.title)}</p>` : ""}
          </div>
        </div>
        <div class="card-meta">
          <span class="meta-journal">${sanitize(p.journal)}</span>
          ${p.date ? `<span class="meta-date">${sanitize(p.date)}</span>` : ""}
          ${p.doi ? `<a class="meta-doi" href="https://doi.org/${encodeURIComponent(p.doi)}" target="_blank" rel="noopener">DOI</a>` : ""}
          ${p.url ? `<a class="meta-pubmed" href="${sanitize(p.url)}" target="_blank" rel="noopener">PubMed</a>` : ""}
        </div>
        <p class="card-summary">${sanitize(p.summary_zh)}</p>
        <div class="pico-grid">
          <div class="pico-item"><span class="pico-label">研究對象</span><span class="pico-value">${sanitize(p.patient_population || "—")}</span></div>
          <div class="pico-item"><span class="pico-label">介入方法</span><span class="pico-value">${sanitize(p.intervention || "—")}</span></div>
          <div class="pico-item"><span class="pico-label">對照基準</span><span class="pico-value">${sanitize(p.comparison || "—")}</span></div>
          <div class="pico-item"><span class="pico-label">主要結果</span><span class="pico-value">${sanitize(p.outcome || "—")}</span></div>
        </div>
        <div class="card-footer">
          <span class="utility utility-${(p.clinical_utility || "low").toLowerCase()}">${p.clinical_utility === "high" ? "臨床實用性 ★★★" : p.clinical_utility === "medium" ? "臨床實用性 ★★" : "臨床實用性 ★"}</span>
          <div class="tags">${(p.tags || []).map((t) => `<span class="tag">${sanitize(t)}</span>`).join("")}</div>
        </div>
      </div>`,
    )
    .join("\n");

  const otherPapersHTML = otherPapers
    .map(
      (p) => `
      <div class="news-card">
        <h3 class="card-title">${sanitize(p.title_zh || p.title)}</h3>
        ${p.title !== p.title_zh ? `<p class="card-title-en">${sanitize(p.title)}</p>` : ""}
        <div class="card-meta">
          <span class="meta-journal">${sanitize(p.journal)}</span>
          ${p.date ? `<span class="meta-date">${sanitize(p.date)}</span>` : ""}
          ${p.url ? `<a class="meta-pubmed" href="${sanitize(p.url)}" target="_blank" rel="noopener">PubMed</a>` : ""}
        </div>
        <p class="card-summary">${sanitize(p.summary_zh)}</p>
      </div>`,
    )
    .join("\n");

  const maxTopic = Math.max(...Object.values(topicDist), 1);
  const topicBarsHTML = Object.entries(topicDist)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(
      ([name, count]) => `
      <div class="topic-row">
        <span class="topic-name">${sanitize(name)}</span>
        <div class="topic-bar-bg"><div class="topic-bar-fill" style="width:${Math.round((count / maxTopic) * 100)}%"></div></div>
        <span class="topic-count">${count}</span>
      </div>`,
    )
    .join("\n");

  const keywordsHTML = keywords.map((k) => `<span class="tag">${sanitize(k)}</span>`).join(" ");

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PGD 文獻日報 · 延長性哀傷疾患 · ${sanitize(date)}</title>
<meta name="description" content="延長性哀傷疾患（PGD）每日文獻日報，${sanitize(date)}，共 ${totalCount} 篇文獻">
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf;--card-bg:color-mix(in srgb,var(--surface) 92%,white)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Noto Sans TC","PingFang TC","Helvetica Neue",Arial,sans-serif;background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);color:var(--text);line-height:1.7;min-height:100vh}
.container{max-width:880px;margin:0 auto;padding:48px 28px 72px}
header{display:flex;align-items:center;gap:18px;margin-bottom:36px;animation:fadeDown .5s ease}
.logo{font-size:44px;line-height:1}
.header-text h1{font-size:22px;font-weight:700;color:var(--text);letter-spacing:-.3px}
.header-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
.badge{display:inline-block;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:500}
.badge-date{background:var(--accent-soft);color:var(--accent)}
.badge-count{background:rgba(90,122,58,.1);color:#5a7a3a}
.badge-source{background:rgba(118,100,83,.08);color:var(--muted)}
.summary-card{background:var(--card-bg);border-radius:24px;padding:28px 30px;border:1px solid var(--line);box-shadow:0 8px 30px rgba(61,36,15,.04);margin-bottom:32px;animation:fadeUp .5s ease}
.summary-card h2{font-size:16px;color:var(--accent);margin-bottom:8px}
.summary-text{font-size:15px;color:var(--text);line-height:1.8}
.section{margin-bottom:32px}
.section-title{font-size:17px;font-weight:700;color:var(--text);margin-bottom:18px;padding-bottom:8px;border-bottom:2px solid var(--accent-soft);display:flex;align-items:center;gap:8px}
.section-icon{font-size:20px}
.news-card{background:var(--card-bg);border-radius:24px;padding:26px 28px;border:1px solid var(--line);box-shadow:0 8px 30px rgba(61,36,15,.04);margin-bottom:16px;transition:transform .2s,box-shadow .2s}
.news-card:hover{transform:translateY(-2px);box-shadow:0 12px 40px rgba(61,36,15,.08)}
.news-card.featured{border-left:3px solid var(--accent)}
.card-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
.rank-badge{background:var(--accent);color:#fff7f0;font-size:13px;font-weight:700;padding:4px 10px;border-radius:6px;white-space:nowrap;flex-shrink:0}
.card-title-group{flex:1}
.card-title{font-size:15.5px;font-weight:600;color:var(--text);line-height:1.5}
.card-title-en{font-size:13px;color:var(--muted);margin-top:2px;font-style:italic;line-height:1.4}
.card-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;font-size:12.5px}
.meta-journal{color:var(--accent);font-weight:600}
.meta-date{color:var(--muted)}
.meta-doi,.meta-pubmed{color:var(--accent);text-decoration:none;font-weight:500}
.meta-doi:hover,.meta-pubmed:hover{text-decoration:underline}
.card-summary{font-size:14.5px;color:var(--text);line-height:1.75;margin-bottom:12px}
.pico-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.pico-item{background:rgba(140,79,43,.04);border-radius:12px;padding:10px 14px}
.pico-label{display:block;font-size:11.5px;font-weight:600;color:var(--accent);margin-bottom:2px;text-transform:uppercase;letter-spacing:.5px}
.pico-value{font-size:13.5px;color:var(--text);line-height:1.5}
.card-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.utility{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.utility-high{color:#5a7a3a;background:rgba(90,122,58,.1)}
.utility-medium{color:#9f7a2e;background:rgba(159,122,46,.1)}
.utility-low{color:var(--muted);background:rgba(118,100,83,.08)}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:500}
.topic-row{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.topic-name{width:90px;font-size:12.5px;color:var(--muted);text-align:right;flex-shrink:0}
.topic-bar-bg{flex:1;height:20px;background:rgba(140,79,43,.06);border-radius:10px;overflow:hidden}
.topic-bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),#c47a4a);border-radius:10px;transition:width .6s ease}
.topic-count{font-size:12.5px;color:var(--accent);font-weight:600;width:24px;text-align:center}
.keywords-section .keywords{display:flex;flex-wrap:wrap;gap:6px}
.clinic-banner{margin:36px 0 12px;padding:22px 28px;background:linear-gradient(135deg,var(--accent-soft),#f5e6d5);border-radius:20px;border:1px solid var(--line);display:flex;flex-direction:column;gap:10px;animation:fadeUp .6s ease}
.clinic-link{display:flex;align-items:center;gap:12px;text-decoration:none;color:var(--accent);font-weight:600;font-size:15px;transition:gap .2s}
.clinic-link:hover{gap:16px}
.clinic-icon{font-size:24px}
.clinic-name{flex:1}
.clinic-arrow{font-size:18px;color:var(--accent)}
.subscribe-section{margin-top:14px;padding:18px 24px;background:var(--card-bg);border-radius:16px;border:1px solid var(--line);display:flex;flex-direction:column;gap:8px}
.subscribe-title{font-size:14px;font-weight:600;color:var(--accent)}
.subscribe-links{display:flex;flex-wrap:wrap;gap:10px}
.subscribe-links a{text-decoration:none;color:var(--accent);font-weight:500;font-size:13.5px;padding:4px 12px;background:var(--accent-soft);border-radius:999px;transition:background .2s}
.subscribe-links a:hover{background:#dcc5a8}
footer{display:flex;justify-content:space-between;align-items:center;padding-top:24px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);flex-wrap:wrap;gap:8px;margin-top:20px}
footer a{color:var(--accent);text-decoration:none}
footer a:hover{text-decoration:underline}
@keyframes fadeDown{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:600px){.container{padding:36px 18px 60px}.summary-card,.news-card{padding:20px 18px}.pico-grid{grid-template-columns:1fr}footer{flex-direction:column;gap:6px;text-align:center}.topic-name{width:70px;font-size:11px}.card-header{flex-direction:column}}
</style>
</head>
<body>
<div class="container">
<header>
<div class="logo">🕯️</div>
<div class="header-text">
<h1>PGD 文獻日報 · 延長性哀傷疾患</h1>
<div class="header-meta">
<span class="badge badge-date">📅 ${sanitize(date)}</span>
<span class="badge badge-count">📊 ${totalCount} 篇文獻</span>
<span class="badge badge-source">Powered by PubMed + NVIDIA Nemotron</span>
</div>
</div>
</header>

<div class="summary-card">
<h2>📋 今日文獻趨勢</h2>
<p class="summary-text">${sanitize(marketSummary)}</p>
</div>

${topPicks.length > 0 ? `<div class="section"><div class="section-title"><span class="section-icon">⭐</span>今日精選 TOP Picks</div>${topPicksHTML}</div>` : ""}

${otherPapers.length > 0 ? `<div class="section"><div class="section-title"><span class="section-icon">📚</span>其他值得關注的文獻</div>${otherPapersHTML}</div>` : ""}

${topicBarsHTML ? `<div class="topic-section section"><div class="section-title"><span class="section-icon">📊</span>主題分佈</div>${topicBarsHTML}</div>` : ""}

${keywords.length > 0 ? `<div class="keywords-section section"><div class="section-title"><span class="section-icon">🏷️</span>關鍵字</div><div class="keywords">${keywordsHTML}</div></div>` : ""}

<div class="clinic-banner">
<a href="https://www.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">
<span class="clinic-icon">🏥</span>
<span class="clinic-name">李政洋身心診所首頁</span>
<span class="clinic-arrow">→</span>
</a>
<a href="https://blog.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">
<span class="clinic-icon">📬</span>
<span class="clinic-name">訂閱電子報</span>
<span class="clinic-arrow">→</span>
</a>
<a href="https://buymeacoffee.com/CYlee" class="clinic-link" target="_blank" rel="noopener">
<span class="clinic-icon">☕</span>
<span class="clinic-name">Buy Me a Coffee</span>
<span class="clinic-arrow">→</span>
</a>
</div>

<footer>
<span>資料來源：PubMed · 分析模型：${sanitize(modelUsed)}</span>
<span><a href="https://github.com/u8901006/prolong-grief-disorder" target="_blank" rel="noopener">GitHub</a></span>
</footer>
</div>
</body>
</html>`;
}

function generateEmptyHTML(date) {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PGD 文獻日報 · 延長性哀傷疾患 · ${sanitize(date)}</title>
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Noto Sans TC","PingFang TC","Helvetica Neue",Arial,sans-serif;background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);color:var(--text);line-height:1.7;min-height:100vh;display:flex;align-items:center;justify-content:center}
.container{max-width:640px;text-align:center;padding:48px 28px}
.logo{font-size:56px;margin-bottom:20px}
h1{font-size:22px;color:var(--text);margin-bottom:10px}
p{color:var(--muted);font-size:15px;margin-bottom:32px}
.clinic-link{display:inline-flex;align-items:center;gap:8px;text-decoration:none;color:var(--accent);font-weight:600;font-size:15px;padding:10px 20px;background:var(--accent-soft);border-radius:999px;margin:6px}
.clinic-link:hover{background:#dcc5a8}
</style>
</head>
<body>
<div class="container">
<div class="logo">🕯️</div>
<h1>PGD 文獻日報 · 延長性哀傷疾患</h1>
<p>${sanitize(date)} — 今日無新的 PGD 相關文獻。請明天再回來查看。</p>
<div>
<a href="https://www.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">🏥 李政洋身心診所</a>
<a href="https://blog.leepsyclinic.com/" class="clinic-link" target="_blank" rel="noopener">📬 訂閱電子報</a>
<a href="https://buymeacoffee.com/CYlee" class="clinic-link" target="_blank" rel="noopener">☕ Buy Me a Coffee</a>
</div>
</div>
</body>
</html>`;
}

async function main() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    console.error("[FATAL] NVIDIA_API_KEY not set");
    process.exit(1);
  }

  if (!existsSync(INPUT_FILE)) {
    console.error("[FATAL] Input file not found:", INPUT_FILE);
    process.exit(1);
  }

  const inputData = JSON.parse(readFileSync(INPUT_FILE, "utf-8"));
  const papers = inputData.papers || [];

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  const outputFile = join(OUTPUT_DIR, `pgd-${TARGET_DATE}.html`);

  if (papers.length === 0) {
    console.error("[INFO] No papers to analyze, generating empty report");
    writeFileSync(outputFile, generateEmptyHTML(TARGET_DATE), "utf-8");
    console.error(`[INFO] Empty report saved to ${outputFile}`);
    return;
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(papers);

  const result = await callNvidiaAI(systemPrompt, userPrompt, apiKey);

  if (!result) {
    console.error("[ERROR] All AI models failed, generating fallback report");
    const fallbackReport = {
      market_summary: `今日共檢索到 ${papers.length} 篇 PGD 相關文獻。AI 分析暫時無法使用，以下為原始文獻列表。`,
      top_picks: [],
      other_papers: papers.map((p) => ({
        title: p.title,
        title_zh: p.title,
        journal: p.journal,
        date: p.date,
        url: p.url,
        summary_zh: (p.abstract || "").slice(0, 150) + "...",
      })),
      keywords: [],
      topic_distribution: {},
    };
    writeFileSync(outputFile, generateHTML(fallbackReport, TARGET_DATE, "fallback (raw list)"), "utf-8");
    console.error(`[INFO] Fallback report saved to ${outputFile}`);
    return;
  }

  const report = safeJSONParse(result.content);
  if (!report) {
    console.error("[ERROR] Failed to parse AI response as JSON, generating fallback");
    const fallbackReport = {
      market_summary: `今日共檢索到 ${papers.length} 篇 PGD 相關文獻。`,
      top_picks: [],
      other_papers: papers.map((p) => ({
        title: p.title,
        title_zh: p.title,
        journal: p.journal,
        date: p.date,
        url: p.url,
        summary_zh: (p.abstract || "").slice(0, 150) + "...",
      })),
      keywords: [],
      topic_distribution: {},
    };
    writeFileSync(outputFile, generateHTML(fallbackReport, TARGET_DATE, `${result.model} (parse error)`), "utf-8");
    return;
  }

  writeFileSync(outputFile, generateHTML(report, TARGET_DATE, result.model), "utf-8");
  console.error(`[INFO] Report saved to ${outputFile}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
