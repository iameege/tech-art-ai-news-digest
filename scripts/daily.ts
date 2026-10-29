import "./_env";

import fs from "node:fs";
import path from "node:path";

import { sources, REPORT_LOCALE } from "../lib/sources/registry";
import { fetchSource } from "../lib/sources/dispatch";
import {
  type ArticleInput,
} from "../lib/ai/pipeline";
import { generateDailyDigest, type DigestOutput } from "../lib/ai/daily-digest";
import { validateBackendCredentials } from "../lib/ai/llm";
import {
  enrichResearchNewsSummaries,
  enrichGithubTrendingSummaries,
  enrichTrendingPapersSummaries,
  enrichXViralSummaries,
} from "../lib/ai/enrich";
// Import groupRaw and helpers from original render.ts, renderHtml from newsnow-v2
import {
  groupRaw,
  isSportsArticle,
  ENRICH_SUBGROUP_LIMITS,
} from "../lib/output/render";
import {
  renderHtml,
  renderMarkdown,
} from "../lib/output/render-newsnow-v2";
import { sendReportEmail } from "../lib/output/email";
import { todayKey } from "../lib/utils";
import { fetchAgentReachMulti } from "../lib/sources/agent-reach";
import { generateSearchQueries } from "../lib/sources/search-queries";

const OUTPUT_DIR = "daily_reports";
const FETCH_BATCH_SIZE = 10; // 并行抓取批大小

async function fetchAll(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  const enabled = sources.filter((s) => s.enabled !== false);

  // 并行批处理抓取（单次重试）
  for (let i = 0; i < enabled.length; i += FETCH_BATCH_SIZE) {
    const batch = enabled.slice(i, i + FETCH_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (source) => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const items = await fetchSource(source);
            console.log(`  ${source.id.padEnd(20)} ${items.length}`);
            return items.map((it) => ({ ...it, source: source.name }));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (attempt === 1) {
              console.warn(`  ${source.id.padEnd(20)} FAILED (retrying) — ${msg}`);
              await new Promise((r) => setTimeout(r, 2000)); // wait 2s before retry
            } else {
              console.error(`  ${source.id.padEnd(20)} FAILED — ${msg}`);
              return [];
            }
          }
        }
        return []; // unreachable, but TypeScript safety
      })
    );
    for (const items of results) {
      articles.push(...items);
    }
  }
  return articles;
}

async function enrichGhTrending(articles: ArticleInput[]): Promise<void> {
  const gh = articles.filter((a) => a.sourceId === "github-trending");
  if (gh.length === 0) return;
  console.log(
    `[daily] enriching ${gh.length} GitHub Trending repos with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichGithubTrendingSummaries(gh);
  for (const a of gh) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${gh.length}`,
  );
}

/**
 * research:research is rendered as a merged time-sorted list (see
 * MERGED_SUBGROUP_LIMITS in render.ts). Enrich exactly the items that
 * will be displayed: take all enabled research:research articles, sort by
 * publishedAt desc, slice to the merge limit, ask Sonnet for Chinese
 * factual summaries.
 */
async function enrichResearchNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "research", "research");
}

async function enrichGameTech(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "games", "game-tech");
}

async function enrichGameNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "games", "game-news");
}

async function enrichUnrealEngine(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "games", "unreal-engine");
}

async function enrichAiNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "tech", "ai-news");
}

/**
 * X 热帖 enrichment is different from merged subgroups — we preserve the
 * AttentionVC API's heat-rank order (do NOT sort by date) and cap to the
 * displayed limit (matches SOURCE_DISPLAY_LIMITS for attentionvc-ai).
 *
 * The Sonnet prompt also differs (XVIRAL_SYSTEM_PROMPT in enrich.ts) — X
 * tweet titles are clickbait, the previewText holds the actual claim.
 */
async function enrichXViral(articles: ArticleInput[]): Promise<void> {
  const xPosts = articles
    .filter((a) => a.sourceId === "attentionvc-ai")
    .slice(0, 20);
  if (xPosts.length === 0) return;
  console.log(`[daily] enriching ${xPosts.length} X posts with ${REPORT_LOCALE} summaries…`);
  const t0 = Date.now();
  // Author handle is encoded in the URL (https://x.com/{handle}/status/{id})
  // — extract it to help the model identify whose claim it is.
  const summaries = await enrichXViralSummaries(
    xPosts.map((a) => ({
      url: a.url,
      title: a.title,
      excerpt: a.excerpt,
      author: a.url.match(/x\.com\/([^/]+)\//)?.[1] ?? "",
    })),
  );
  for (const a of xPosts) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${xPosts.length}`,
  );
}

/**
 * Trending papers enrichment — preserves the fetcher's upvote-desc order
 * (huggingface-papers is in PRESERVE_FETCH_ORDER_SOURCES) and caps to the
 * displayed limit (matches SOURCE_DISPLAY_LIMITS for huggingface-papers).
 */
async function enrichTrendingPapers(articles: ArticleInput[]): Promise<void> {
  const papers = articles
    .filter((a) => a.sourceId === "huggingface-papers")
    .slice(0, 20);
  if (papers.length === 0) return;
  console.log(
    `[daily] enriching ${papers.length} trending papers with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichTrendingPapersSummaries(
    papers.map((a) => ({ url: a.url, title: a.title, excerpt: a.excerpt })),
  );
  for (const a of papers) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${papers.length}`,
  );
}

/**
 * Shared implementation for "merged subgroup" enrichment: collect all
 * enabled articles in (category, subcategory), sort by date desc, take
 * the display cap (from MERGED_SUBGROUP_LIMITS), and ask the LLM to
 * summarize them into REPORT_LOCALE in a single batch. Symmetric to the
 * merge logic in render.ts groupRaw, so display and enrichment stay aligned.
 *
 * Sources whose `lang` already matches REPORT_LOCALE are skipped — no
 * point translating English to English (en mode) or Chinese to Chinese
 * (zh mode).
 */
async function enrichMergedSubgroup(
  articles: ArticleInput[],
  category: "tech" | "research" | "games",
  subcategory: string,
): Promise<void> {
  const subSources = sources.filter(
    (s) =>
      s.category === category &&
      s.subcategory === subcategory &&
      s.enabled !== false,
  );
  const sameLocaleIds = new Set(
    subSources.filter((s) => (s.lang ?? "en") === REPORT_LOCALE).map((s) => s.id),
  );
  const limit = ENRICH_SUBGROUP_LIMITS[`${category}:${subcategory}`] ?? 10;

  // Process each source independently - enrich top N per source
  let totalEnriched = 0;
  let totalToEnrich = 0;

  for (const source of subSources) {
    const sourceArticles = articles
      .filter((a) => a.sourceId === source.id)
      .filter((a) => category !== "games" || !isSportsArticle(a.title))
      .sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      )
      .slice(0, limit);

    const toEnrich = sourceArticles.filter((a) => !sameLocaleIds.has(a.sourceId));
    if (toEnrich.length === 0) continue;

    totalToEnrich += toEnrich.length;
  }

  if (totalToEnrich === 0) return;

  console.log(
    `[daily] enriching ${totalToEnrich} ${category}:${subcategory} items with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();

  // Enrich all sources together in one batch call
  const allToEnrich: ArticleInput[] = [];
  for (const source of subSources) {
    const sourceArticles = articles
      .filter((a) => a.sourceId === source.id)
      .filter((a) => category !== "games" || !isSportsArticle(a.title))
      .sort(
        (a, b) =>
          (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
      )
      .slice(0, limit)
      .filter((a) => !sameLocaleIds.has(a.sourceId));

    allToEnrich.push(...sourceArticles);
  }

  if (allToEnrich.length === 0) return;

  const summaries = await enrichResearchNewsSummaries(allToEnrich);
  for (const a of allToEnrich) {
    const s = summaries.get(a.url);
    if (s) {
      a.summary = s;
      totalEnriched++;
    }
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${totalEnriched}/${allToEnrich.length}`,
  );
}

async function main() {
  // Fail fast on misconfigured backend before we spend 30s fetching
  // 500+ articles only to discover the LLM has no credentials.
  validateBackendCredentials();

  const date = todayKey();
  console.log(`[daily] ${date} — fetching sources…\n`);
  const articles = await fetchAll();
  console.log(`\n[daily] total articles: ${articles.length}`);

  // Agent Reach — multi-platform search (YouTube/B站/V2EX)
  const projectRoot = path.resolve(__dirname, "..");
  const existingUrls = new Set(articles.map((a) => a.url));
  console.log(`[daily] running Agent Reach search…`);
  const arQueries = generateSearchQueries(projectRoot);
  const arResult = await fetchAgentReachMulti(arQueries, existingUrls, "games", "game-tech", 5, 0, projectRoot);
  for (const a of arResult.articles) {
    articles.push({ ...a, source: "Agent Reach" });
  }
  console.log(
    `[daily] agent-reach: ${arQueries.length} queries, ${arResult.totalResults} results, ${arResult.articles.length} new (${arResult.dupes} dupes)`,
  );
  console.log(`[daily] total articles (with Agent Reach): ${articles.length}`);

  if (articles.length === 0) {
    throw new Error("no articles fetched — aborting");
  }

  // Filter out stale articles — keep only those published within the last 2 days.
  // Sources without publishedAt (e.g. GitHub Trending) are always kept.
  const maxAgeMs = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const before = articles.length;
  const recent = articles.filter((a) => {
    if (!a.publishedAt) return true; // no date → keep (e.g. GH trending)
    const ts = a.publishedAt instanceof Date ? a.publishedAt.getTime() : new Date(a.publishedAt).getTime();
    if (Number.isNaN(ts)) return true; // unparseable date → keep
    return (now - ts) < maxAgeMs;
  });
  articles.length = 0;
  articles.push(...recent);
  const filtered = before - articles.length;
  if (filtered > 0) {
    console.log(`[daily] filtered ${filtered} stale articles (older than 2 days), ${articles.length} remaining`);
  }

  // Enrich GH Trending, papers, research news, and games with summaries.
  // Sequential enrichment to avoid API rate limiting (parallel caused timeouts).
  await enrichGhTrending(articles);
  await enrichTrendingPapers(articles);
  await enrichResearchNews(articles);
  await enrichGameTech(articles);
  await enrichGameNews(articles);
  await enrichUnrealEngine(articles);
  await enrichAiNews(articles);
  await enrichXViral(articles);

  // Generate daily summary (Prompt B) — retry once on failure
  console.log(`[daily] generating daily summary (Prompt B)…`);
  const t0 = Date.now();
  let dailyDigest: DigestOutput | undefined;
  try {
    dailyDigest = await generateDailyDigest(articles);
    console.log(`[daily] daily summary ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[daily] daily summary failed (retrying): ${msg}`);
    try {
      dailyDigest = await generateDailyDigest(articles);
      console.log(`[daily] daily summary ready on retry in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e2) {
      console.warn(`[daily] daily summary generation failed:`, e2);
    }
  }

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);
  const raw = groupRaw(articles, sources);
  // Save digest as the main JSON
  fs.writeFileSync(`${base}.json`, JSON.stringify(dailyDigest ?? {}, null, 2), "utf8");
  // Sidecar with all fetched articles + LLM-attached summary, so
  // scripts/render.ts can rebuild HTML/MD for UI iteration without
  // re-fetching or re-calling the LLM.
  fs.writeFileSync(
    `${base}-articles.json`,
    JSON.stringify({ date, articles }, null, 2),
    "utf8",
  );
  fs.writeFileSync(`${base}.html`, renderHtml(raw, date, dailyDigest), "utf8");
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(date), "utf8");
    console.log(`[daily] wrote ${base}.{json,html,md,articles.json}`);
  } else {
    console.log(`[daily] wrote ${base}.{json,html,articles.json}`);
  }

  // Send email if EMAIL_TO is configured — full HTML as attachment
  const emailTo = process.env.EMAIL_TO?.trim();
  if (emailTo) {
    const htmlContent = fs.readFileSync(`${base}.html`, "utf8");
    const bodyText = dailyDigest
      ? `${dailyDigest.narrative}\n\n打开附件查看完整每日新闻。`
      : `打开附件查看完整每日新闻。`;
    await sendReportEmail({
      to: emailTo,
      subject: `游戏 技术 美术 每日新闻 · ${date}`,
      bodyText,
      htmlContent,
      filename: `${date}.html`,
      date,
    });
  }

  console.log(`[daily] done.`);
}

main().catch((e) => {
  console.error(`[daily] FAILED:`, e);
  process.exit(1);
});
