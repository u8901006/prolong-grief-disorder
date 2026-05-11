# Prolonged Grief Disorder (PGD) Daily Literature Report

自動化的延長性哀傷疾患每日文獻追蹤系統。

## 功能

- 每日自動從 PubMed 檢索最新的 PGD 相關文獻
- 使用 Zhipu AI (GLM-5-Turbo) 進行繁體中文摘要、分類與分析
- 生成美觀的 HTML 網頁並部署至 GitHub Pages
- 每日 GMT+8 08:50 自動執行

## 技術架構

- **Node.js 24** — 執行腳本
- **PubMed E-utilities API** — 文獻檢索
- **Zhipu AI GLM-5-Turbo** — AI 分析（fallback: GLM-4.7 → GLM-4.7-Flash）
- **GitHub Actions** — 定時排程
- **GitHub Pages** — 靜態網頁託管

## 線上瀏覽

👉 [https://u8901006.github.io/prolong-grief-disorder/](https://u8901006.github.io/prolong-grief-disorder/)

## 授權

本專案僅供學術研究與教育用途。
