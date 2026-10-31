import type {
  ArticleInput,
} from "../ai/pipeline";
import type { DigestOutput } from "../ai/daily-digest";
import { REPORT_LOCALE } from "../sources/registry";
import {
  groupRaw as groupRawFromRender,
  type RawByCategory,
} from "./render";

// ----- i18n -----
const TEXTS_ZH = {
  siteTitle: "游戏 技术 美术 每日新闻",
  siteAuthor: "By: tech-art-ai-news-digest",
  catTech: "AI技术新闻",
  catFinance: "前沿研究",
  catGames: "游戏新闻",
  catCommunity: "社区讨论",
  catGameTech: "游戏技术",
  footer: "内容均来自原媒体，本站仅作摘要整理与回链。",
};
const STR = TEXTS_ZH;

// ----- CSS from preview-newsnow-style-a.html -----
const NEWSNOW_CSS = `
  :root {
    --bg: #fafafa;
    --bg-card: rgba(255,255,255,0.7);
    --fg: #1a1a1a;
    --fg-soft: #666;
    --muted: #999;
    --border: rgba(0,0,0,0.08);
    --accent-blue: #3b82f6;
    --accent-green: #22c55e;
    --accent-purple: #a855f7;
    --accent-orange: #f97316;
    --radius: 16px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0a0a0a;
      --bg-card: rgba(30,30,30,0.8);
      --fg: #fafafa;
      --fg-soft: #aaa;
      --muted: #666;
      --border: rgba(255,255,255,0.1);
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { position: relative;
    color: var(--fg);
    line-height: 1.5;
    min-height: 100vh;
    padding: 24px;
  }

  /* Header */
  .header {
    text-align: center;
    margin-bottom: 32px;
  }
  .header h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .header-author {
    color: #1a1a1a;
    font-size: 12px;
    margin-bottom: 2px;
    font-weight: 600;
  }
  .header .date {
    color: #1a1a1a;
    font-size: 14px;
    font-weight: 600;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .tab {
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    font-size: 14px;
    font-weight: 500;
    color: var(--fg-soft);
    cursor: pointer;
    transition: all 0.2s;
  }
  .tab:hover { border-color: var(--accent-blue); color: var(--fg); }
  .tab.active { background: var(--fg); color: var(--bg); border-color: var(--fg); }
  .tab .count {
    font-size: 12px;
    opacity: 0.7;
    margin-left: 4px;
  }

  /* Grid Layout */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 20px;
    max-width: 1400px;
    margin: 0 auto;
  }

  /* Card */
  .card {
    background: var(--bg-card);
    border-radius: var(--radius);
    padding: 16px;
    backdrop-filter: blur(10px);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    max-height: 400px;
  }
  .card.blue { border-top: 3px solid var(--accent-blue); }
  .card.green { border-top: 3px solid var(--accent-green); }
  .card.purple { border-top: 3px solid var(--accent-purple); }
  .card.orange { border-top: 3px solid var(--accent-orange); }
  .card.red { border-top: 3px solid #ef4444; }

  /* Card Header */
  .card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .card-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
  }
  .card-title {
    font-size: 18px;
    font-weight: 600;
  }
  .card-meta {
    font-size: 12px;
    color: var(--muted);
  }

  /* News List */
  .news-list {
    list-style: none;
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .news-list::-webkit-scrollbar {
    width: 6px;
  }
  .news-list::-webkit-scrollbar-track {
    background: transparent;
  }
  .news-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 3px;
  }
  .news-list::-webkit-scrollbar-thumb:hover {
    background: var(--muted);
  }
  .news-item {
    display: flex;
    gap: 10px;
    padding: 10px 8px;
    border-radius: 8px;
    transition: background 0.15s;
    cursor: pointer;
  }
  .news-item:hover { background: rgba(0,0,0,0.04); }
  @media (prefers-color-scheme: dark) {
    .news-item:hover { background: rgba(255,255,255,0.05); }
  }

  .news-rank {
    min-width: 24px;
    height: 24px;
    background: var(--border);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: var(--fg-soft);
  }
  .news-content { flex: 1; min-width: 0; }
  .news-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--fg);
    text-decoration: none;
    display: block;
  }
  .news-title:hover { color: var(--accent-blue); }
  .news-meta {
    font-size: 11px;
    color: var(--muted);
    margin-top: 3px;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .news-time {
    color: var(--accent-blue);
    font-weight: 500;
  }
  .news-extra {
    opacity: 0.8;
  }
  .news-summary {
    font-size: 12px;
    color: var(--fg);
    background: rgba(59, 130, 246, 0.1);
    border-left: 2px solid var(--accent-blue);
    padding: 6px 8px;
    margin-top: 6px;
    border-radius: 4px;
  }

  /* Footer */
  .footer {
    text-align: center;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 12px;
  }

  /* Card visibility for tab switching */
  .hidden { display: none !important; }

  /* Daily Digest Styles - 匹配 daily-digest-preview-v4.html */
  .digest-container {
    max-width: 900px;
    margin: 0 auto 32px;
    padding: 0 24px;
  }
  .narrative-highlight {
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 16px;
    color: #1a1a1a;
    background: rgba(255,255,255,0.9);
    border-radius: 10px;
    padding: 14px 18px;
    border: 1px solid rgba(255,255,255,0.6);
  }
  .narrative-highlight h2 {
    display: none;
  }
  .narrative-highlight p {
    font-size: 13px;
    color: #1a1a1a;
    line-height: 1.5;
  }
  .cross-discovery {
    background: rgba(168,85,247,0.9);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
    border: 1px solid rgba(168,85,247,0.85);
  }
  .cross-discovery h3 {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 6px;
  }
  .cross-discovery ul {
    list-style: none;
    font-size: 13px;
    color: #fff;
  }
  .cross-discovery li {
    padding: 3px 0;
    padding-left: 14px;
    position: relative;
  }
  .cross-discovery li::before {
    content: "→";
    position: absolute;
    left: 0;
    color: #fff;
    font-size: 11px;
  }
  .ab-layout {
    display: flex;
    gap: 16px;
  }
  @media (max-width: 768px) {
    .ab-layout { flex-direction: column; }
    .digest-container { padding: 0 16px; }
  }
  .importance-group, .domain-group {
    flex: 1;
    background: rgba(255,255,255,0.9);
    border-radius: 12px;
    padding: 16px;
    border: 1px solid var(--border);
  }
  .importance-group h3, .domain-group h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }
  .importance-section {
    margin-bottom: 10px;
  }
  .importance-section:last-child { margin-bottom: 0; }
  .importance-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .importance-item {
    font-size: 13px;
    color: #1a1a1a;
    padding: 3px 0;
    border-bottom: none;
    line-height: 1.4;
    padding-left: 14px;
    position: relative;
  }
  .importance-item::before {
    content: "→";
    position: absolute;
    left: 0;
    color: var(--accent-blue);
    font-size: 11px;
  }
  .domain-section {
    margin-bottom: 10px;
  }
  .domain-section:last-child { margin-bottom: 0; }
  .domain-label {
    font-size: 12px;
    font-weight: 600;
    color: #1a1a1a;
    margin-bottom: 4px;
  }
  .domain-items {
    font-size: 13px;
    color: #1a1a1a;
    line-height: 1.5;
  }

body::before {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  /* background image placeholder — set your own via body::before */
  z-index: -2;
}
body::after {
  content: '';
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(255,255,255,0.2);
  z-index: -1;
}
@media (prefers-color-scheme: dark) {
  body::after { background: rgba(0,0,0,0.5); }
}
`;

// ----- helpers -----
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(date?: Date): string {
  if (!date) return "";
  // Format as MM-DD HH:mm
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${month}-${day} ${hour}:${min}`;
}

// ----- types -----
// Re-export shared types and constants from ./render for convenience
export type { RawByCategory, SourceGroup, SubGroup } from "./render";
export { MERGED_SUBGROUP_LIMITS, ENRICH_SUBGROUP_LIMITS } from "./render";

// Re-export groupRaw for use by daily.ts
export const groupRaw = groupRawFromRender;

// ----- source to card config -----
const SOURCE_CONFIG: Record<string, {
  icon: string;
  color: "blue" | "green" | "purple" | "orange" | "red";
  tab: string;
}> = {
  // AI技术新闻 tab (第一行: GitHub Trending, X AI Posts, TechCrunch; 第二行: TLDR AI, HuggingFace Blog, MIT Tech Review)
  "github-trending": { icon: "GH", color: "blue", tab: "ai-news" },
  "attentionvc-ai": { icon: "X", color: "orange", tab: "ai-news" },
  "techcrunch": { icon: "TC", color: "purple", tab: "ai-news" },
  "tldr-ai": { icon: "TL", color: "green", tab: "ai-news" },
  "huggingface-blog": { icon: "HF", color: "green", tab: "ai-news" },
  "mit-tech-review-ai": { icon: "MIT", color: "green", tab: "ai-news" },
  // 虚幻引擎 tab
  "unreal-engine-blog": { icon: "UE", color: "purple", tab: "unreal-engine" },
  "realtime-vfx": { icon: "VFX", color: "purple", tab: "unreal-engine" },
  "tom-looman": { icon: "TL", color: "blue", tab: "unreal-engine" },
  "william-faucher": { icon: "WF", color: "purple", tab: "unreal-engine" },
  "ben-cloward": { icon: "BC", color: "blue", tab: "unreal-engine" },
  "unreal-engine-youtube": { icon: "UE", color: "red", tab: "unreal-engine" },
  "tech-artists-org": { icon: "TA", color: "purple", tab: "unreal-engine" },
  // 游戏技术 tab
  "nvidia-developer": { icon: "NV", color: "green", tab: "game-tech" },
  "amd-gpuopen": { icon: "AMD", color: "red", tab: "game-tech" },
  "blender": { icon: "BL", color: "orange", tab: "game-tech" },
  "gdc-technology": { icon: "GDT", color: "red", tab: "game-tech" },
  "stefan-3d-ai": { icon: "S3", color: "green", tab: "game-tech" },
  "neural4d": { icon: "N4", color: "green", tab: "game-tech" },
  "roboflow": { icon: "RF", color: "blue", tab: "game-tech" },
  // 游戏新闻 tab
  "80lv": { icon: "80", color: "purple", tab: "game-news" },
  "gamesindustry": { icon: "GI", color: "orange", tab: "game-news" },
  "pc-gamer": { icon: "PC", color: "orange", tab: "game-news" },
  "gamedeveloper": { icon: "GD", color: "blue", tab: "game-news" },
  // 前沿研究 tab
  "huggingface-papers": { icon: "HP", color: "blue", tab: "research" },
  "arxiv-cs-gr": { icon: "GR", color: "blue", tab: "research" },
  "acm-siggraph-blog": { icon: "SG", color: "purple", tab: "research" },
  "arxiv-cs-cv": { icon: "CV", color: "blue", tab: "research" },
  "arxiv-cs-ro": { icon: "RO", color: "blue", tab: "research" },
  "arxiv-cs-ai": { icon: "AI", color: "blue", tab: "research" },
  "arxiv-cs-lg": { icon: "LG", color: "blue", tab: "research" },
  "acm-siggraph-youtube": { icon: "YT", color: "red", tab: "research" },
  "agent-reach": { icon: "AR", color: "green", tab: "game-tech" },
};

// Helper to get config for a source, handling merged sources
function getSourceConfig(sourceId: string, articles: ArticleInput[]): { icon: string; color: "blue" | "green" | "purple" | "orange" | "red"; tab: string } {
  let config = SOURCE_CONFIG[sourceId];
  if (!config && sourceId === "_merged") {
    // For merged sources, infer from first article's category
    const category = articles[0]?.category;
    if (category === "research") {
      return { icon: "R", color: "blue", tab: "research" };
    }
  }
  return config ?? { icon: "??", color: "blue", tab: "other" };
}

// Source display limits per tab
const TAB_DISPLAY_LIMITS: Record<string, number> = {
  "ai-news": 10,
  "unreal-engine": 10,
  "game-tech": 10,
  "game-news": 5,  // 游戏新闻每个 source 只显示 5 条
  "research": 10,
};

// ----- render card from single source -----
function renderCardFromSource(
  sourceId: string,
  sourceName: string,
  articles: ArticleInput[]
): string {
  const config = getSourceConfig(sourceId, articles);
  const displayLimit = TAB_DISPLAY_LIMITS[config.tab] ?? 10;

  const newsItems = articles
    .slice(0, displayLimit)
    .map(
      (item, i) => `
      <li class="news-item">
        <span class="news-rank">${i + 1}</span>
        <div class="news-content">
          <a class="news-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
          <div class="news-meta">
            <span class="news-time">${formatTime(item.publishedAt)}</span>
            ${item.meta ? `<span class="news-extra">${escapeHtml(item.meta)}</span>` : ""}
          </div>
          ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ""}
        </div>
      </li>`
    )
    .join("\n");

  return `
    <div class="card ${config.color}" data-tab="${config.tab}">
      <div class="card-header">
        <div class="card-icon">${config.icon}</div>
        <div>
          <div class="card-title">${escapeHtml(sourceName)}</div>
          <div class="card-meta">${articles.length} 条</div>
        </div>
      </div>
      <ol class="news-list">${newsItems}</ol>
    </div>`;
}

// ----- main renderer -----
export function renderHtml(
  raw: RawByCategory,
  date: string,
  digest?: DigestOutput,
): string {
  const cards: string[] = [];

  // Process each source individually - one card per source
  // Tech category
  for (const sub of raw.tech ?? []) {
    for (const src of sub.sources) {
      if (src.items.length > 0) {
        cards.push(renderCardFromSource(src.sourceId, src.sourceName, src.items));
      }
    }
  }

  // Games category (game-tech, game-news)
  for (const sub of raw.games ?? []) {
    for (const src of sub.sources) {
      if (src.items.length > 0) {
        cards.push(renderCardFromSource(src.sourceId, src.sourceName, src.items));
      }
    }
  }

  // Research category
  for (const sub of raw.research ?? []) {
    for (const src of sub.sources) {
      if (src.items.length > 0) {
        cards.push(renderCardFromSource(src.sourceId, src.sourceName, src.items));
      }
    }
  }

  // Count items for each tab
  const counts = {
    aiNews: 0,
    unrealEngine: 0,
    gameTech: 0,
    gameNews: 0,
    research: 0,
  };

  // Count by source using SOURCE_CONFIG
  for (const sub of raw.tech ?? []) {
    for (const src of sub.sources) {
      const config = getSourceConfig(src.sourceId, src.items);
      const count = src.items.length;
      if (config.tab === "ai-news") counts.aiNews += count;
    }
  }

  for (const sub of raw.games ?? []) {
    for (const src of sub.sources) {
      const config = getSourceConfig(src.sourceId, src.items);
      const count = src.items.length;
      if (config.tab === "unreal-engine") counts.unrealEngine += count;
      else if (config.tab === "game-tech") counts.gameTech += count;
      else if (config.tab === "game-news") counts.gameNews += count;
    }
  }

  for (const sub of raw.research ?? []) {
    for (const src of sub.sources) {
      const config = getSourceConfig(src.sourceId, src.items);
      const count = src.items.length;
      if (config.tab === "research") counts.research += count;
    }
  }

  const tabs = [
    { label: "今日摘要", count: 1, id: "daily-digest" },
    { label: "AI技术新闻", count: counts.aiNews, id: "ai-news" },
    { label: "虚幻引擎", count: counts.unrealEngine, id: "unreal-engine" },
    { label: "游戏技术", count: counts.gameTech, id: "game-tech" },
    { label: "游戏新闻", count: counts.gameNews, id: "game-news" },
    { label: "前沿研究", count: counts.research, id: "research" },
  ];

  const tabsHtml = tabs
    .map((t, i) => `<button class="tab${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label} <span class="count">${t.count}</span></button>`)
    .join("\n");

  const tabSwitchJs = `
  document.querySelectorAll('.tabs .tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      // Update tab active state
      document.querySelectorAll('.tabs .tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      // Show/hide cards and digest
      var tabId = btn.dataset.tab;
      var digestEl = document.getElementById('daily-digest-section');
      var gridEl = document.querySelector('.grid');
      if (digestEl) {
        digestEl.classList.toggle('hidden', tabId !== 'daily-digest');
      }
      if (gridEl) {
        gridEl.classList.toggle('hidden', tabId === 'daily-digest');
      }
      document.querySelectorAll('.card').forEach(function(card) {
        if (card.dataset.tab === tabId) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });
  // Initialize: show daily-digest, hide grid
  document.addEventListener('DOMContentLoaded', function() {
    var gridEl = document.querySelector('.grid');
    if (gridEl) gridEl.classList.add('hidden');
  });
  `;

  // Daily digest HTML content (dynamic from Prompt B or fallback)
  const digestHtml = digest ? `
<div id="daily-digest-section" class="digest-container">
  <div class="narrative-highlight">
    <h2>今日叙事</h2>
    <p>${escapeHtml(digest.narrative)}</p>
  </div>

  ${digest.crossDiscovery.length > 0 ? `
  <div class="cross-discovery">
    <h3>跨领域发现</h3>
    <ul>
      ${digest.crossDiscovery.map(item => `<li>${escapeHtml(item)}</li>`).join("\n      ")}
    </ul>
  </div>
  ` : ""}

  <div class="ab-layout">
    <div class="importance-group">
      <h3>A. 重要性分级</h3>
      ${digest.importanceHigh.length > 0 ? `
      <div class="importance-section">
        <div class="importance-label">🔴 高影响力</div>
        ${digest.importanceHigh.map(item => `<div class="importance-item">${escapeHtml(item)}</div>`).join("\n        ")}
      </div>
      ` : ""}
      ${digest.importanceMedium.length > 0 ? `
      <div class="importance-section">
        <div class="importance-label">🟡 值得关注</div>
        ${digest.importanceMedium.map(item => `<div class="importance-item">${escapeHtml(item)}</div>`).join("\n        ")}
      </div>
      ` : ""}
      ${digest.importanceLow.length > 0 ? `
      <div class="importance-section">
        <div class="importance-label">🟢 信息速览</div>
        ${digest.importanceLow.map(item => `<div class="importance-item">${escapeHtml(item)}</div>`).join("\n        ")}
      </div>
      ` : ""}
    </div>

    <div class="domain-group">
      <h3>B. 领域聚合</h3>
      ${digest.domainAI ? `
      <div class="domain-section">
        <div class="domain-label">AI与技术</div>
        <div class="domain-items">${escapeHtml(digest.domainAI)}</div>
      </div>
      ` : ""}
      ${digest.domainGame ? `
      <div class="domain-section">
        <div class="domain-label">游戏与引擎</div>
        <div class="domain-items">${escapeHtml(digest.domainGame)}</div>
      </div>
      ` : ""}
      ${digest.domainArt ? `
      <div class="domain-section">
        <div class="domain-label">美术与工具</div>
        <div class="domain-items">${escapeHtml(digest.domainArt)}</div>
      </div>
      ` : ""}
      ${digest.domainResearch ? `
      <div class="domain-section">
        <div class="domain-label">学术前沿</div>
        <div class="domain-items">${escapeHtml(digest.domainResearch)}</div>
      </div>
      ` : ""}
    </div>
  </div>
</div>
` : `
<div id="daily-digest-section" class="digest-container">
  <div class="narrative-highlight">
    <h2>今日叙事</h2>
    <p>今日摘要生成中，请稍后再试。</p>
  </div>
</div>
`;

  return `<!doctype html>
<html lang="${REPORT_LOCALE === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${STR.siteTitle} · ${date}</title>
<style>${NEWSNOW_CSS}</style>
</head>
<body>

<header class="header">
  <h1>${STR.siteTitle}</h1>
  <div class="header-author">${STR.siteAuthor}</div>
  <div class="date">${date}</div>
</header>

<nav class="tabs">
${tabsHtml}
</nav>

${digestHtml}
<div class="grid">
${cards.join("\n")}
</div>

<footer class="footer">${STR.footer}</footer>

<script>${tabSwitchJs}</script>
</body>
</html>`;
}

export function renderMarkdown(date: string): string {
  return `# ${STR.siteTitle} - ${date}`;
}
