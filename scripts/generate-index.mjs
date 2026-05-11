#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS_DIR = process.env.REPORTS_DIR || "docs";

function sanitize(str) {
  if (typeof str !== "string") return String(str);
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

const files = readdirSync(REPORTS_DIR)
  .filter((f) => f.startsWith("pgd-") && f.endsWith(".html") && f !== "index.html")
  .sort()
  .reverse();

const links = files.slice(0, 60)
  .map((f) => {
    const date = f.replace("pgd-", "").replace(".html", "");
    let dateDisplay = date;
    let weekday = "";
    try {
      const d = new Date(date + "T00:00:00+08:00");
      dateDisplay = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      weekday = weekdays[d.getUTCDay()] || "";
    } catch {}
    return `<li><a href="${sanitize(f)}">📅 ${sanitize(dateDisplay)}（週${sanitize(weekday)}）</a></li>`;
  })
  .join("\n");

const total = files.length;

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PGD 文獻日報 · 延長性哀傷疾患</title>
<meta name="description" content="延長性哀傷疾患（Prolonged Grief Disorder）每日文獻日報索引，共 ${total} 期">
<style>
:root{--bg:#f6f1e8;--surface:#fffaf2;--line:#d8c5ab;--text:#2b2118;--muted:#766453;--accent:#8c4f2b;--accent-soft:#ead2bf}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Noto Sans TC","PingFang TC","Helvetica Neue",Arial,sans-serif;background:radial-gradient(circle at top,#fff6ea 0,var(--bg) 55%,#ead8c6 100%);color:var(--text);line-height:1.7;min-height:100vh}
.container{max-width:640px;margin:0 auto;padding:60px 28px 80px;text-align:center}
.logo{font-size:56px;margin-bottom:16px}
h1{font-size:24px;font-weight:700;color:var(--text);margin-bottom:6px}
.subtitle{font-size:14px;color:var(--muted);margin-bottom:8px}
.count{font-size:13px;color:var(--accent);font-weight:500;margin-bottom:32px}
ul{list-style:none;text-align:left}
ul li{margin-bottom:8px}
ul li a{display:block;padding:14px 20px;background:var(--surface);border:1px solid var(--line);border-radius:16px;text-decoration:none;color:var(--text);font-size:14.5px;font-weight:500;transition:transform .2s,box-shadow .2s}
ul li a:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(61,36,15,.08);border-color:var(--accent)}
footer{margin-top:40px;font-size:12.5px;color:var(--muted)}
footer a{color:var(--accent);text-decoration:none}
footer a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="container">
<div class="logo">🕯️</div>
<h1>PGD 文獻日報</h1>
<p class="subtitle">延長性哀傷疾患（Prolonged Grief Disorder）· 每日自動更新</p>
<p class="count">共 ${total} 期日報</p>
<ul>
${links}
</ul>
<footer>
<span>Powered by PubMed + Zhipu AI</span>
<span>·</span>
<a href="https://github.com/u8901006/prolong-grief-disorder" target="_blank" rel="noopener">GitHub</a>
</footer>
</div>
</body>
</html>`;

const outPath = join(REPORTS_DIR, "index.html");
writeFileSync(outPath, html, "utf-8");
console.error(`[INFO] Index page saved to ${outPath} (${total} reports)`);
