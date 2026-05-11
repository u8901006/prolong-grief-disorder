#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { URL, URLSearchParams } from "node:url";

const TARGET_DATE = process.env.TARGET_DATE || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || "7", 10);
const MAX_PAPERS = parseInt(process.env.MAX_PAPERS || "40", 10);

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const JOURNALS = [
  "Am J Psychiatry",
  "JAMA Psychiatry",
  "Lancet Psychiatry",
  "World Psychiatry",
  "Br J Psychiatry",
  "Acta Psychiatr Scand",
  "Aust N Z J Psychiatry",
  "Eur Psychiatry",
  "Asian J Psychiatry",
  "Transcult Psychiatry",
  "Psychiatry Res",
  "J Psychiatr Res",
  "BMC Psychiatry",
  "Front Psychiatry",
  "Sci Rep",
  "PLOS ONE",
  "J Affect Disord",
  "Depress Anxiety",
  "J Anxiety Disord",
  "J Trauma Stress",
  "Eur J Psychotraumatol",
  "Psychol Trauma",
  "Death Stud",
  "Omega (Westport)",
  "Clin Psychol Rev",
  "Behav Res Ther",
  "J Consult Clin Psychol",
  "Psychol Assess",
  "Assessment",
  "NeuroImage",
  "Biol Psychiatry",
  "Mol Psychiatry",
  "Transl Psychiatry",
  "Palliat Med",
  "J Pain Symptom Manage",
  "Psychooncology",
  "Aging Ment Health",
  "Gerontologist",
  "Int Psychogeriatrics",
  "Am J Geriatr Psychiatry",
  "J Am Acad Child Adolesc Psychiatry",
  "J Child Psychol Psychiatry",
  "Eur Child Adolesc Psychiatry",
  "Am J Public Health",
  "BMJ Open",
  "BMC Public Health",
  "Soc Sci Med",
  "BMJ Support Palliat Care",
  "J Psychosom Res",
  "JMIR Ment Health",
  "Psychosom Med",
  "Ann Behav Med",
  "Sleep Med",
  "J Clin Nurs",
  "Soc Psychiatry Psychiatr Epidemiol",
  "Gen Hosp Psychiatry",
  "J Psychosoc Oncol",
  "J Loss Trauma",
  "J Palliat Med",
  "Cogn Behav Ther",
  "Clin Psychol Psychother",
  "Psychol Med",
  "J Ment Health",
];

const SEARCH_TERMS = [
  '"prolonged grief disorder"[tiab]',
  '"prolonged grief"[tiab]',
  '"complicated grief"[tiab]',
  '"persistent complex bereavement disorder"[tiab]',
  '"traumatic grief"[tiab]',
  '"pathological grief"[tiab]',
  '"disordered grief"[tiab]',
  '"complicated bereavement"[tiab]',
  '"Prolonged Grief Disorder"[Mesh]',
];

function buildQuery() {
  const termBlock = SEARCH_TERMS.join(" OR ");
  const journalBlock = JOURNALS.map((j) => `"${j}"[ta]`).join(" OR ");
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86400000);
  const sinceStr = since.toISOString().slice(0, 10).replace(/-/g, "/");
  const dateBlock = `"${sinceStr}"[Date - Publication] : "3000"[Date - Publication]`;
  return `(${termBlock}) AND (${journalBlock}) AND ${dateBlock}`;
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "PGD-LiteratureBot/1.0 (research aggregator)" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "PGD-LiteratureBot/1.0 (research aggregator)" },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function parseXML(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    let title = "";
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
    }
    const abstractParts = [];
    const absRegex = /<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let absMatch;
    while ((absMatch = absRegex.exec(block)) !== null) {
      const labelMatch = absMatch[0].match(/Label="([^"]+)"/);
      const label = labelMatch ? labelMatch[1] : "";
      const text = absMatch[1].replace(/<[^>]+>/g, "").trim();
      if (text) {
        abstractParts.push(label ? `${label}: ${text}` : text);
      }
    }
    const abstract = abstractParts.join(" ").slice(0, 2000);

    const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
    const journal = journalMatch ? journalMatch[1].trim() : "";

    const yearMatch = block.match(/<Year>(\d+)<\/Year>/);
    const monthMatch = block.match(/<Month>([^<]+)<\/Month>/);
    const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
    const dateParts = [
      yearMatch?.[1],
      monthMatch?.[1],
      dayMatch?.[1],
    ].filter(Boolean);
    const dateStr = dateParts.join(" ");

    const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
    const pmid = pmidMatch ? pmidMatch[1] : "";
    const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";

    const keywords = [];
    const kwRegex = /<Keyword>([^<]+)<\/Keyword>/g;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(block)) !== null) {
      keywords.push(kwMatch[1].trim());
    }

    const doiMatch = block.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/);
    const doi = doiMatch ? doiMatch[1].trim() : "";

    if (title) {
      papers.push({ pmid, title, journal, date: dateStr, abstract, url, keywords, doi });
    }
  }
  return papers;
}

async function main() {
  const query = buildQuery();
  console.error(`[INFO] Searching PubMed for PGD papers from last ${LOOKBACK_DAYS} days...`);

  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(MAX_PAPERS),
    sort: "date",
    retmode: "json",
  });

  let ids = [];
  try {
    const searchResult = await fetchJSON(`${PUBMED_SEARCH}?${params}`);
    ids = searchResult?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[ERROR] PubMed search failed: ${e.message}`);
  }

  console.error(`[INFO] Found ${ids.length} papers`);

  let papers = [];
  if (ids.length > 0) {
    const fetchParams = new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "xml",
    });
    try {
      const xml = await fetchText(`${PUBMED_FETCH}?${fetchParams}`);
      papers = parseXML(xml);
    } catch (e) {
      console.error(`[ERROR] PubMed fetch failed: ${e.message}`);
    }
  }

  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  const output = {
    date: TARGET_DATE,
    count: papers.length,
    papers,
  };

  writeFileSync("papers.json", JSON.stringify(output, null, 2), "utf-8");
  console.error(`[INFO] Saved to papers.json`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
