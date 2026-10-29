// Trend Report Generator
//
// Reads all historical daily_reports/<date>/<date>-articles.json,
// auto-extracts tech phrases from titles+excerpts,
// normalizes (% of articles per day),
// groups by trend direction (rising / new / falling / stable),
// outputs an interactive HTML report with Chart.js line charts.
//
// Usage:
//   npx tsx scripts/trend-report.ts
//   npx tsx scripts/trend-report.ts --days 14   (only last 14 days)
//
// Output: daily_reports/trend-report.html

import "./_env";

import fs from "node:fs";
import path from "node:path";

// ── Config ──────────────────────────────────────────────────────────────────

const REPORTS_DIR = "daily_reports";
const OUTPUT_PATH = "daily_reports/trend-report.html";

/** Minimum number of days a phrase must appear in to be tracked */
const MIN_DAYS = 4;

/** Minimum total occurrences across all articles to be tracked */
const MIN_TOTAL = 8;

/** Trend thresholds (comparing recent window vs older window) */
const RISING_THRESHOLD = 1.5;   // recent avg > older avg × 1.5
const FALLING_THRESHOLD = 0.5;  // recent avg < older avg × 0.5
const STABLE_MIN_PCT = 2;       // minimum avg % to be "stable high-frequency"

/** Recent window = last N data points; older = the rest */
const RECENT_WINDOW = 4;

// ── Tech phrase extraction ──────────────────────────────────────────────────

/**
 * Seed words used to identify technical phrases.
 * NOT a whitelist — these are used to detect that a bigram is tech-related.
 * Phrases that appear ≥5 times globally are also auto-included regardless.
 */
const TECH_SEEDS = new Set([
  // AI / ML
  "AI", "LLM", "GPT", "CLIP", "RAG", "LoRA", "MCP", "CoT", "MoE",
  "agent", "model", "diffusion", "transformer", "embedding", "fine-tun",
  "inference", "training", "neural", "deep learn", "reinforcement",
  // 3D / graphics
  "3D", "2D", "mesh", "texture", "shader", "voxel", "pixel", "vertex",
  "render", "ray", "rasteriz", "GPU", "Vulkan", "OpenGL", "DirectX",
  "splat", "gaussian", "nerf", "radiance", "point cloud",
  // Game engine
  "Unreal", "Unity", "Godot", "Houdini", "Blender", "Maya", "Substance",
  "Niagara", "PCG", "VFX", "Lumen", "Nanite", "MetaSound",
  "USD", "VDB", "Alembic", "FBX", "glTF",
  // Simulation / robotics
  "physics", "simulat", "robot", "embodied", "kinemat",
  "Isaac", "Omniverse", "Cosmos", "rigid body", "cloth", "fluid",
  // Pipeline / workflow
  "pipeline", "workflow", "procedur", "automat", "batch",
  "asset", "scene", "material", "lighting", "composit",
  // Chinese tech terms
  "仿真", "渲染", "物理", "程序化", "具身", "智能", "生成",
  "管线", "材质", "特效", "引擎", "机器人", "世界模型",
]);

/** Stop words to filter out from bigram extraction */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "not", "no", "yes", "and", "or",
  "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "this", "that", "these", "those", "it", "its", "we", "our", "you",
  "your", "they", "their", "he", "she", "his", "her", "new", "how",
  "what", "which", "who", "when", "where", "why", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such",
  "than", "too", "very", "just", "about", "above", "after", "before",
  "between", "into", "through", "during", "again", "once", "here",
  "there", "out", "up", "down", "over", "under", "only", "own",
  "same", "so", "if", "also", "then", "because", "as", "until",
  "while", "get", "got", "make", "made", "use", "used", "using",
  "way", "like", "just", "know", "need", "want", "look", "see",
  "come", "take", "find", "give", "tell", "work", "call", "try",
  "ask", "seem", "feel", "leave", "put", "mean", "keep", "let",
  "begin", "show", "hear", "play", "run", "move", "live", "believe",
  "bring", "happen", "write", "provide", "sit", "stand", "lose",
  "pay", "meet", "include", "continue", "set", "learn", "change",
  "lead", "understand", "watch", "follow", "stop", "create", "speak",
  "read", "allow", "add", "spend", "grow", "open", "walk", "win",
  "offer", "remember", "love", "consider", "appear", "buy", "wait",
  "serve", "die", "send", "expect", "build", "stay", "fall", "cut",
  "reach", "kill", "remain", "suggest", "raise", "pass", "sell",
  "require", "report", "decide", "pull", "develop", "announce",
  "launch", "release", "update", "announce", "introduce", "reveal",
  "announce", "share", "post", "publish", "feature", "support",
  "enable", "improve", "fix", "add", "remove", "change", "update",
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人",
  "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去",
  "你", "会", "着", "没有", "看", "好", "自己", "这",
]);

/**
 * Extract technical phrases from a text string.
 * Returns an array of phrases (1-3 words) that are likely tech terms.
 */
function extractTechPhrases(text: string): string[] {
  const results: string[] = [];
  const clean = text
    .replace(/[<>'"()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Split into words
  const words = clean.split(/\s+/).filter(w => w.length > 0);

  // Extract unigrams that are tech seeds
  for (const w of words) {
    const lower = w.toLowerCase();
    if (TECH_SEEDS.has(w) || TECH_SEEDS.has(lower)) {
      results.push(w);
    }
  }

  // Extract bigrams (2-word phrases)
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];

    // Skip if either is a stop word
    if (STOP_WORDS.has(w1.toLowerCase()) || STOP_WORDS.has(w2.toLowerCase())) continue;
    // Skip very short words
    if (w1.length < 2 || w2.length < 2) continue;
    // Skip pure numbers
    if (/^\d+$/.test(w1) || /^\d+$/.test(w2)) continue;

    const bigram = `${w1} ${w2}`;

    // Include if either word is a tech seed
    const w1IsTech = TECH_SEEDS.has(w1) || TECH_SEEDS.has(w1.toLowerCase());
    const w2IsTech = TECH_SEEDS.has(w2) || TECH_SEEDS.has(w2.toLowerCase());
    if (w1IsTech || w2IsTech) {
      results.push(bigram);
    }
  }

  // Extract trigrams (3-word phrases) — only if middle word is a connector
  const CONNECTORS = new Set(["of", "for", "in", "to", "on", "with", "-", "—", "based"]);
  for (let i = 0; i < words.length - 2; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];
    const w3 = words[i + 2];

    if (!CONNECTORS.has(w2.toLowerCase())) continue;
    if (STOP_WORDS.has(w1.toLowerCase()) || STOP_WORDS.has(w3.toLowerCase())) continue;

    const w1IsTech = TECH_SEEDS.has(w1) || TECH_SEEDS.has(w1.toLowerCase());
    const w3IsTech = TECH_SEEDS.has(w3) || TECH_SEEDS.has(w3.toLowerCase());
    if (w1IsTech || w3IsTech) {
      results.push(`${w1} ${w2} ${w3}`);
    }
  }

  return results;
}

// ── Data loading ────────────────────────────────────────────────────────────

interface DayData {
  date: string;
  totalArticles: number;
  phraseCounts: Record<string, number>;
}

function loadHistoricalData(maxDays?: number): DayData[] {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error(`[trend-report] ${REPORTS_DIR} not found`);
    return [];
  }

  const dates = fs.readdirSync(REPORTS_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  const targetDates = maxDays ? dates.slice(-maxDays) : dates;
  const results: DayData[] = [];

  for (const date of targetDates) {
    const artPath = path.join(REPORTS_DIR, date, `${date}-articles.json`);
    if (!fs.existsSync(artPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(artPath, "utf8"));
      const articles: Array<{ title?: string; excerpt?: string }> =
        Array.isArray(raw) ? raw : (raw.articles ?? []);

      if (articles.length === 0) continue;

      const phraseCounts: Record<string, number> = {};
      for (const a of articles) {
        const text = `${a.title ?? ""} ${a.excerpt ?? ""}`;
        const phrases = extractTechPhrases(text);
        for (const p of phrases) {
          phraseCounts[p] = (phraseCounts[p] ?? 0) + 1;
        }
      }

      results.push({
        date,
        totalArticles: articles.length,
        phraseCounts,
      });
    } catch {
      // Skip unparseable files
    }
  }

  return results;
}

// ── Trend computation ───────────────────────────────────────────────────────

interface PhraseTrend {
  phrase: string;
  dailyPct: number[];       // normalized % for each day
  recentAvg: number;        // average over recent window
  olderAvg: number;         // average over older window
  direction: "rising" | "new" | "falling" | "stable";
  daysPresent: number;      // how many days this phrase appeared
  totalOccurrences: number; // total raw count across all days
}

function computeTrends(days: DayData[]): PhraseTrend[] {
  // 1. Collect all phrases and their global stats
  const phraseGlobalCounts: Record<string, number> = {};
  const phraseDaysPresent: Record<string, number> = {};

  for (const day of days) {
    for (const [phrase, count] of Object.entries(day.phraseCounts)) {
      phraseGlobalCounts[phrase] = (phraseGlobalCounts[phrase] ?? 0) + count;
      if (count > 0) {
        phraseDaysPresent[phrase] = (phraseDaysPresent[phrase] ?? 0) + 1;
      }
    }
  }

  // 2. Filter: only track phrases that appear enough
  const trackedPhrases = Object.entries(phraseGlobalCounts)
    .filter(([, total]) => total >= MIN_TOTAL)
    .filter(([phrase, total]) => {
      const daysPresent = phraseDaysPresent[phrase] ?? 0;
      // Either appears in enough days, OR has high total count
      return daysPresent >= MIN_DAYS || total >= MIN_TOTAL * 3;
    })
    .map(([phrase]) => phrase);

  // 3. Compute daily % for each tracked phrase
  const trends: PhraseTrend[] = [];

  for (const phrase of trackedPhrases) {
    const dailyPct: number[] = [];
    let totalOccurrences = 0;

    for (const day of days) {
      const count = day.phraseCounts[phrase] ?? 0;
      const pct = day.totalArticles > 0 ? (count / day.totalArticles) * 100 : 0;
      dailyPct.push(Math.round(pct * 100) / 100);
      totalOccurrences += count;
    }

    const daysPresent = phraseDaysPresent[phrase] ?? 0;

    // Split into recent vs older window
    const recentStart = Math.max(0, dailyPct.length - RECENT_WINDOW);
    const recentSlice = dailyPct.slice(recentStart);
    const olderSlice = dailyPct.slice(0, recentStart);

    const recentAvg = recentSlice.length > 0
      ? recentSlice.reduce((a, b) => a + b, 0) / recentSlice.length
      : 0;
    const olderAvg = olderSlice.length > 0
      ? olderSlice.reduce((a, b) => a + b, 0) / olderSlice.length
      : 0;

    // Classify direction
    let direction: PhraseTrend["direction"];

    if (olderAvg < 0.5 && recentAvg >= 1) {
      // Was low-frequency or absent, now meaningfully present
      direction = "new";
    } else if (olderAvg > 0 && recentAvg > olderAvg * RISING_THRESHOLD) {
      direction = "rising";
    } else if (olderAvg > 0 && recentAvg < olderAvg * FALLING_THRESHOLD && olderAvg >= 1) {
      // Only mark as "falling" if the older average was at least 1%
      // — otherwise it's just low-frequency noise
      direction = "falling";
    } else if (recentAvg >= STABLE_MIN_PCT) {
      direction = "stable";
    } else {
      // Low frequency, no clear trend — skip
      continue;
    }

    trends.push({
      phrase,
      dailyPct,
      recentAvg,
      olderAvg,
      direction,
      daysPresent,
      totalOccurrences,
    });
  }

  return trends;
}

// ── Deduplication ───────────────────────────────────────────────────────────

/**
 * Remove near-duplicate phrases.
 * 1. Case-normalize: "Agent" and "agent" are the same → keep the one with more occurrences
 * 2. Substring: "Unreal Engine" subsumes "Unreal" → keep the longer one if similar frequency
 * 3. Semantic overlap: "3D Gaussian" and "Gaussian Splatting" → keep the more common one
 */
function dedupTrends(trends: PhraseTrend[]): PhraseTrend[] {
  // Sort by total occurrences descending — prefer more common phrasing
  const sorted = [...trends].sort((a, b) => b.totalOccurrences - a.totalOccurrences);
  const kept: PhraseTrend[] = [];
  const keptLower = new Set<string>();

  for (const t of sorted) {
    const lower = t.phrase.toLowerCase();

    // Skip if exact case-insensitive match already kept
    if (keptLower.has(lower)) continue;

    // Check if a very similar phrase was already kept
    let isDuplicate = false;
    for (const existingLower of keptLower) {
      // 1. Substring match: "Unreal" is subsumed by "Unreal Engine"
      if (lower.includes(existingLower) || existingLower.includes(lower)) {
        const existingTrend = kept.find(k => k.phrase.toLowerCase() === existingLower);
        if (existingTrend) {
          // If the longer phrase has >= 30% of the shorter's frequency, keep the longer
          const longer = lower.length >= existingLower.length ? t : existingTrend;
          const shorter = lower.length >= existingLower.length ? existingTrend : t;
          if (longer.totalOccurrences >= shorter.totalOccurrences * 0.3) {
            // The shorter one is a subset — skip it
            if (shorter.phrase === t.phrase) {
              isDuplicate = true;
              break;
            }
          }
        }
      }

      // 2. Word overlap: "AI Agents" vs "Agent" — if they share a core word
      //    and the shorter one has >= 50% of the longer's frequency, they're likely the same topic
      const tWords = new Set(lower.split(/\s+/));
      const eWords = new Set(existingLower.split(/\s+/));
      const overlap = [...tWords].filter(w => eWords.has(w) && w.length > 2);
      if (overlap.length > 0 && overlap.length >= Math.min(tWords.size, eWords.size) - 1) {
        // Significant word overlap — likely same topic
        const existingTrend = kept.find(k => k.phrase.toLowerCase() === existingLower);
        if (existingTrend && existingTrend.totalOccurrences >= t.totalOccurrences * 0.5) {
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      kept.push(t);
      keptLower.add(lower);
    }
  }

  return kept;
}

// ── HTML generation ─────────────────────────────────────────────────────────

function generateHtml(days: DayData[], trends: PhraseTrend[]): string {
  const dates = days.map(d => d.date);
  const dateLabels = dates.map(d => d.slice(5)); // "MM-DD"

  const grouped = {
    rising: dedupTrends(trends.filter(t => t.direction === "rising"))
      .sort((a, b) => b.recentAvg - a.recentAvg),
    new: dedupTrends(trends.filter(t => t.direction === "new"))
      .sort((a, b) => b.recentAvg - a.recentAvg),
    falling: dedupTrends(trends.filter(t => t.direction === "falling"))
      .sort((a, b) => b.olderAvg - a.olderAvg),
    stable: dedupTrends(trends.filter(t => t.direction === "stable"))
      .sort((a, b) => b.recentAvg - a.recentAvg),
  };

  // Build chart datasets for each group
  function buildChartConfig(title: string, items: PhraseTrend[], emoji: string): string {
    if (items.length === 0) return "";

    // Color palette
    const colors = [
      "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
      "#3498db", "#9b59b6", "#e91e63", "#00bcd4", "#8bc34a",
      "#ff5722", "#607d8b", "#795548", "#cddc39", "#03a9f4",
    ];

    const datasets = items.slice(0, 12).map((item, i) => {
      const color = colors[i % colors.length];
      const data = item.dailyPct.map(v => v || null); // null = gap in chart
      return `{
        label: ${JSON.stringify(item.phrase)},
        data: [${data.map(d => d === null ? "null" : d).join(", ")}],
        borderColor: "${color}",
        backgroundColor: "${color}22",
        fill: false,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6,
        borderWidth: 2,
      }`;
    }).join(",\n");

    // Summary table rows
    const tableRows = items.slice(0, 20).map(item => {
      const change = item.olderAvg > 0
        ? `${item.olderAvg.toFixed(1)}% → ${item.recentAvg.toFixed(1)}%`
        : `0% → ${item.recentAvg.toFixed(1)}%`;
      const ratio = item.olderAvg > 0
        ? `×${(item.recentAvg / item.olderAvg).toFixed(1)}`
        : "🆕";
      return `<tr>
        <td><span style="color:${colors[items.indexOf(item) % colors.length]}">●</span> ${item.phrase}</td>
        <td>${change}</td>
        <td>${ratio}</td>
        <td>${item.daysPresent}/${days.length}天</td>
        <td>${item.totalOccurrences}</td>
      </tr>`;
    }).join("");

    return `
    <div class="chart-section">
      <h2>${emoji} ${title}</h2>
      <div class="chart-container">
        <canvas id="chart-${title.replace(/\s+/g, "-")}"></canvas>
      </div>
      <table>
        <thead><tr><th>关键词</th><th>变化</th><th>倍率</th><th>出现天数</th><th>总出现次数</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <script>
      new Chart(document.getElementById("chart-${title.replace(/\s+/g, "-")}"), {
        type: "line",
        data: {
          labels: ${JSON.stringify(dateLabels)},
          datasets: [${datasets}],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  return ctx.dataset.label + ": " + (ctx.parsed.y !== null ? ctx.parsed.y.toFixed(1) + "%" : "无数据");
                }
              }
            }
          },
          scales: {
            y: {
              title: { display: true, text: "占文章百分比 (%)" },
              beginAtZero: true,
            },
            x: {
              title: { display: true, text: "日期" },
            }
          }
        }
      });
    </script>`;
  }

  // Overview chart: all rising + new on one chart
  const overviewItems = [...grouped.rising.slice(0, 6), ...grouped.new.slice(0, 6)];
  const overviewColors = [
    "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db",
    "#9b59b6", "#e91e63", "#00bcd4", "#8bc34a", "#ff5722", "#607d8b",
  ];
  const overviewDatasets = overviewItems.map((item, i) => {
    const color = overviewColors[i % overviewColors.length];
    const data = item.dailyPct.map(v => v || null);
    return `{
      label: ${JSON.stringify((item.direction === "new" ? "🆕 " : "📈 ") + item.phrase)},
      data: [${data.map(d => d === null ? "null" : d).join(", ")}],
      borderColor: "${color}",
      backgroundColor: "${color}22",
      fill: false,
      tension: 0.3,
      pointRadius: 3,
      pointHoverRadius: 6,
      borderWidth: 2,
    }`;
  }).join(",\n");

  const dateRange = days.length > 0
    ? `${days[0].date} → ${days[days.length - 1].date}`
    : "无数据";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>技术趋势报告 · ${dateRange}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0d1117; color: #c9d1d9; padding: 24px; max-width: 1200px; margin: 0 auto;
    }
    h1 { font-size: 24px; margin-bottom: 8px; color: #f0f6fc; }
    h2 { font-size: 18px; margin: 24px 0 12px; color: #f0f6fc; }
    .meta { color: #8b949e; margin-bottom: 24px; font-size: 14px; }
    .chart-section { margin-bottom: 40px; }
    .chart-container { position: relative; height: 350px; margin-bottom: 16px; }
    table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      background: #161b22; border-radius: 6px; overflow: hidden;
    }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; }
    th { background: #1c2128; color: #8b949e; font-weight: 600; }
    td { color: #c9d1d9; }
    tr:hover td { background: #1c2128; }
    .summary-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px; margin-bottom: 32px;
    }
    .summary-card {
      background: #161b22; border-radius: 8px; padding: 16px;
      border-left: 3px solid;
    }
    .summary-card.rising { border-color: #2ecc71; }
    .summary-card.new { border-color: #3498db; }
    .summary-card.falling { border-color: #e74c3c; }
    .summary-card.stable { border-color: #f1c40f; }
    .summary-card h3 { font-size: 14px; color: #8b949e; margin-bottom: 8px; }
    .summary-card .count { font-size: 28px; font-weight: 700; color: #f0f6fc; }
    .summary-card .examples { font-size: 12px; color: #8b949e; margin-top: 8px; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>📊 技术趋势报告</h1>
  <p class="meta">${dateRange} · ${days.length} 天数据 · ${trends.length} 个追踪词</p>

  <div class="summary-grid">
    <div class="summary-card rising">
      <h3>📈 上升</h3>
      <div class="count">${grouped.rising.length}</div>
      <div class="examples">${grouped.rising.slice(0, 5).map(t => t.phrase).join(" · ")}</div>
    </div>
    <div class="summary-card new">
      <h3>🆕 新出现</h3>
      <div class="count">${grouped.new.length}</div>
      <div class="examples">${grouped.new.slice(0, 5).map(t => t.phrase).join(" · ")}</div>
    </div>
    <div class="summary-card falling">
      <h3>📉 下降</h3>
      <div class="count">${grouped.falling.length}</div>
      <div class="examples">${grouped.falling.slice(0, 5).map(t => t.phrase).join(" · ")}</div>
    </div>
    <div class="summary-card stable">
      <h3>➡️ 稳定高频</h3>
      <div class="count">${grouped.stable.length}</div>
      <div class="examples">${grouped.stable.slice(0, 5).map(t => t.phrase).join(" · ")}</div>
    </div>
  </div>

  ${overviewItems.length > 0 ? `
  <h2>🔥 上升 & 新出现 — 总览</h2>
  <div class="chart-container">
    <canvas id="chart-overview"></canvas>
  </div>
  <script>
    new Chart(document.getElementById("chart-overview"), {
      type: "line",
      data: {
        labels: ${JSON.stringify(dateLabels)},
        datasets: [${overviewDatasets}],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, padding: 8, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(ctx) {
                return ctx.dataset.label + ": " + (ctx.parsed.y !== null ? ctx.parsed.y.toFixed(1) + "%" : "无数据");
              }
            }
          }
        },
        scales: {
          y: { title: { display: true, text: "占文章百分比 (%)" }, beginAtZero: true },
          x: { title: { display: true, text: "日期" } }
        }
      }
    });
  </script>` : ""}

  ${buildChartConfig("上升 (Rising)", grouped.rising, "📈")}
  ${buildChartConfig("新出现 (New)", grouped.new, "🆕")}
  ${buildChartConfig("下降 (Falling)", grouped.falling, "📉")}
  ${buildChartConfig("稳定高频 (Stable)", grouped.stable, "➡️")}

</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  let maxDays: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      maxDays = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log("[trend-report] loading historical data…");
  const days = loadHistoricalData(maxDays);
  console.log(`[trend-report] loaded ${days.length} days of data`);

  if (days.length < 3) {
    console.error("[trend-report] need at least 3 days of data — aborting");
    process.exit(1);
  }

  console.log("[trend-report] computing trends…");
  const trends = computeTrends(days);
  console.log(`[trend-report] tracking ${trends.length} phrases`);

  const byDir = {
    rising: trends.filter(t => t.direction === "rising").length,
    new: trends.filter(t => t.direction === "new").length,
    falling: trends.filter(t => t.direction === "falling").length,
    stable: trends.filter(t => t.direction === "stable").length,
  };
  console.log(`[trend-report] 📈${byDir.rising} 🆕${byDir.new} 📉${byDir.falling} ➡️${byDir.stable}`);

  console.log("[trend-report] generating HTML…");
  const html = generateHtml(days, trends);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, html, "utf8");
  console.log(`[trend-report] wrote ${OUTPUT_PATH}`);
}

main();
