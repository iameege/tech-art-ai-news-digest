/**
 * Agent Reach fetcher — multi-platform search (YouTube/B站/V2EX).
 *
 * Supplements RSS feeds with platform-specific content that RSS can't reach:
 * - B站视频搜索 (public API, no auth needed)
 * - V2EX 热门主题 (public API, no auth needed)
 * - YouTube 搜索 (requires yt-dlp + browser cookies for auth)
 *
 * Non-fatal: on error (missing yt-dlp, API failure, rate limit), returns an
 * empty array — the pipeline continues with whatever succeeded.
 *
 * No API key required. YouTube search needs `--cookies-from-browser` if
 * YouTube blocks the request (bot detection).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Category, RawArticle } from "./types";

// ── YouTube ────────────────────────────────────────────────────────────────

/**
 * Search YouTube via yt-dlp. Returns NDJSON — one JSON object per video.
 * Requires yt-dlp installed. If yt-dlp is missing or YouTube blocks the
 * request (bot detection), returns [] silently.
 */
function fetchYoutubeSearch(
  query: string,
  category: Category,
  subcategory: string | undefined,
  limit: number,
): RawArticle[] {
  try {
    // Try with cookies from browser first (avoids bot detection), fallback to no cookies
    let stdout: string;
    try {
      stdout = execSync(
        `yt-dlp --dump-json "ytsearch${limit}:${query}" --cookies-from-browser chrome --no-warnings --playlist-end ${limit}`,
        { timeout: 60_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
    } catch {
      // Fallback without cookies (may hit bot detection)
      stdout = execSync(
        `yt-dlp --dump-json "ytsearch${limit}:${query}" --no-warnings --playlist-end ${limit}`,
        { timeout: 60_000, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
    }

    const results: RawArticle[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const v = JSON.parse(trimmed);
        const url = v.webpage_url ?? v.url ?? `https://www.youtube.com/watch?v=${v.id}`;
        const desc = (v.description ?? "").slice(0, 300);
        const dur = v.duration_string ?? "";
        const views = v.view_count ?? 0;
        results.push({
          sourceId: "agent-reach",
          title: (v.title ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
          url,
          excerpt: desc,
          publishedAt: v.upload_date
            ? new Date(`${v.upload_date.slice(0, 4)}-${v.upload_date.slice(4, 6)}-${v.upload_date.slice(6, 8)}`)
            : new Date(),
          category,
          subcategory,
          meta: `${dur}${dur && views ? " · " : ""}${views ? views.toLocaleString() + " views" : ""}`,
        });
      } catch {
        // Skip unparseable lines
      }
    }
    return results;
  } catch {
    // yt-dlp not installed, or YouTube blocked the request — non-fatal
    return [];
  }
}

// ── Bilibili ───────────────────────────────────────────────────────────────

interface BiliVideoItem {
  title: string;
  bvid: string;
  author: string;
  description: string;
  pubdate: number;       // unix timestamp (seconds)
  play: number;          // view count
  danmaku: number;       // bullet comment count
  duration: string;      // e.g. "10:30"
  pic: string;           // thumbnail URL
}

/**
 * Filter out B站 results that are obviously not TA-relevant.
 * B站 search is fuzzy — a query like "3D" can match medical CT, 3D
 * contests, relationship videos (TA→他/她), etc.
 */
const BILI_SKIP_PATTERNS = [
  // 情感/塔罗/恋爱 (B站 misinterprets "TA" as "他/她")
  /塔罗|星座|恋爱|情感|关系发展|恋爱|脱单|相亲|挽回|复合|表白/,
  // 医学
  /腰椎|胸廓|CT.*重建|骨骼.*重建|手术|病例|影像|病理|肿瘤|骨折/,
  // 比赛/报名/科普（非技术）
  /大赛报名|操作示例|高考|考研|四六级|公务员/,
  // 硬件设置科普（不是技术教程）
  /硬件加速.*建议|显卡驱动|电脑.*设置|BIOS/,
  // 纯产品推广
  /广告|推广|优惠|打折|秒杀/,
];

function isBiliRelevant(title: string): boolean {
  const clean = title.replace(/<[^>]+>/g, "");
  return !BILI_SKIP_PATTERNS.some((p) => p.test(clean));
}

/**
 * Search Bilibili videos via public API. No auth needed.
 * Returns up to `limit` results matching the query.
 */
async function fetchBilibiliSearch(
  query: string,
  category: Category,
  subcategory: string | undefined,
  limit: number,
): Promise<RawArticle[]> {
  try {
    const url = `https://api.bilibili.com/x/web-interface/search/all/v2?keyword=${encodeURIComponent(query)}&page=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.bilibili.com",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return [];

    const json = await response.json() as { code: number; data?: { result?: Array<{ result_type: string; data?: BiliVideoItem[] }> } };
    if (json.code !== 0) return [];

    // Find the "video" result group, filter out irrelevant content
    const videoGroup = (json.data?.result ?? []).find((r) => r.result_type === "video");
    const items = (videoGroup?.data ?? [])
      .filter((v) => isBiliRelevant(v.title))
      .slice(0, limit);

    return items.map((v) => ({
      sourceId: "agent-reach",
      title: v.title.replace(/<[^>]+>/g, ""), // strip <em class="keyword"> tags
      url: `https://www.bilibili.com/video/${v.bvid}`,
      excerpt: (v.description ?? "").slice(0, 300),
      publishedAt: v.pubdate ? new Date(v.pubdate * 1000) : new Date(),
      category,
      subcategory,
      meta: `${v.author}${v.play ? " · " + v.play.toLocaleString() + " 播放" : ""}`,
    }));
  } catch {
    return [];
  }
}

// ── V2EX ───────────────────────────────────────────────────────────────────

interface V2exTopic {
  id: number;
  title: string;
  url: string;
  content: string;
  content_rendered: string;
  replies: number;
  created: number;       // unix timestamp (seconds)
  member: { username: string };
  node: { name: string; title: string };
}

/**
 * Fetch hot topics from V2EX. No auth needed.
 * Returns up to `limit` topics.
 */
async function fetchV2exHot(
  category: Category,
  subcategory: string | undefined,
  limit: number,
): Promise<RawArticle[]> {
  try {
    const response = await fetch("https://www.v2ex.com/api/topics/hot.json", {
      headers: { "User-Agent": "agent-reach/1.0" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return [];

    const topics = (await response.json() as V2exTopic[]).slice(0, limit);

    return topics.map((t) => ({
      sourceId: "agent-reach",
      title: t.title,
      url: t.url,
      excerpt: (t.content ?? "").slice(0, 300) || (t.content_rendered ?? "").replace(/<[^>]+>/g, "").slice(0, 300),
      publishedAt: t.created ? new Date(t.created * 1000) : new Date(),
      category,
      subcategory,
      meta: `${t.node.title} · ${t.member.username} · ${t.replies} 回复`,
    }));
  } catch {
    return [];
  }
}

// ── Unified entry point ────────────────────────────────────────────────────

/** Hardcoded Chinese baseline queries for Bilibili (always included) */
const BILI_BASELINE_QUERIES: string[] = [
  // UE5 核心 — 加 "教程/技术" 限定避免搜到新闻/科普
  "UE5 Niagara 特效 VFX 技术教程",
  "Unreal Engine 材质 shader 技术美术",
  "虚幻引擎 PCG 程序化生成 教程",
  "UE5 Nanite Lumen 渲染优化",
  // 3D 生成/重建 — 加 "游戏/实时" 限定避免搜到医学CT
  "3D Gaussian Splatting 游戏引擎",
  "NeRF 三维重建 实时渲染 游戏",
  // DCC 工具
  "Blender Houdini 程序化 游戏资产",
  // AI + 技术美术 — 加限定避免搜到情感/塔罗
  "AI 3D生成 贴图 游戏美术 工具",
  "AI辅助 shader 材质 技术美术",
  // 具身智能+仿真 — 覆盖中国机器人/仿真行业动态
  "具身智能 仿真 技术",
  "机器人仿真 虚幻引擎",
  "物理仿真 游戏引擎 实时",
  "Isaac Sim 教程 技术",
  // 游戏行业招聘 — 覆盖中国游戏美术/TA/AI岗位市场动态
  "游戏行业 招聘 技术美术 2026",
  "游戏美术 岗位 招聘 薪资",
  "游戏 技术美术 TA 求职",
  "游戏 AI岗位 招聘 2026",
  "游戏行业 裁员 就业 2026",
];

/** Fallback when likes.md has no Chinese content */
const BILI_FALLBACK_QUERIES = BILI_BASELINE_QUERIES;

/**
 * Generate B站-specific Chinese queries from likes.md.
 *
 * likes.md ★ lines have Chinese descriptions after "—", which are perfect
 * B站 search keywords. These are ADDED on top of the hardcoded baseline
 * so updates to likes.md expand coverage without losing the baseline.
 */
function generateBiliQueries(projectRoot: string): string[] {
  const queries = [...BILI_BASELINE_QUERIES];

  try {
    const likesPath = path.join(projectRoot, "likes.md");
    if (!fs.existsSync(likesPath)) return queries;
    const content = fs.readFileSync(likesPath, "utf8");

    for (const line of content.split("\n")) {
      const match = line.match(/-?\s*★\s*(.+)/);
      if (!match) continue;

      // Extract the Chinese description after "—"
      const dashParts = match[1].split("—");
      const desc = (dashParts.length > 1 ? dashParts.slice(1).join("—") : dashParts[0]).trim();

      // Only keep if it contains Chinese characters (relevant for B站)
      if (!/[一-鿿]/.test(desc)) continue;
      if (desc.length < 4) continue;

      // Replace "TA" (Technical Artist) with "技术美术" to avoid
      // B站 interpreting "TA" as "他/她" (relationship/情感 content)
      // Also add qualifiers to overly-broad terms to reduce noise
      let cleaned = desc
        .replace(/\bTA\b/g, "技术美术")
        .replace(/3D(?!\s*(Gaussian|生成|重建|建模|美术|引擎|资产))/g, "3D 游戏美术")
        .replace(/AI(?!\s*(辅助|生成|3D|工具|shader|材质))/g, "AI 游戏技术美术");

      queries.push(cleaned.slice(0, 60));
    }
  } catch {
    // Non-fatal
  }

  return queries;
}

/**
 * Run multi-platform searches via Agent Reach and return deduplicated articles.
 *
 * - B站: search with Chinese keywords (B站 content is Chinese-dominant)
 * - YouTube: search with English keywords (requires yt-dlp + cookies)
 * - V2EX: disabled by default (content too generic for TA focus)
 * - Deduplicates against existingUrls and within results
 */
export async function fetchAgentReachMulti(
  queries: string[],
  existingUrls: Set<string>,
  category: Category = "games",
  subcategory = "game-tech",
  limitPerQuery = 5,
  v2exLimit = 0,
  projectRoot?: string,
): Promise<{ articles: RawArticle[]; totalResults: number; dupes: number }> {
  if (queries.length === 0) {
    return { articles: [], totalResults: 0, dupes: 0 };
  }

  const allResults: RawArticle[] = [];
  let totalResults = 0;
  let dupes = 0;

  // B站 search with Chinese keywords (high signal for TA content)
  // Generate queries from likes.md (auto-updates with user preferences)
  const biliQueries = projectRoot
    ? generateBiliQueries(projectRoot)
    : BILI_FALLBACK_QUERIES;

  for (const query of biliQueries) {
    const biliResults = await fetchBilibiliSearch(query, category, subcategory, limitPerQuery);
    totalResults += biliResults.length;

    for (const article of biliResults) {
      if (existingUrls.has(article.url)) {
        dupes++;
        continue;
      }
      existingUrls.add(article.url);
      allResults.push(article);
    }
  }

  // YouTube search with English queries from caller (requires cookies)
  for (const query of queries) {
    const ytResults = fetchYoutubeSearch(query, category, subcategory, limitPerQuery);
    totalResults += ytResults.length;

    for (const article of ytResults) {
      if (existingUrls.has(article.url)) {
        dupes++;
        continue;
      }
      existingUrls.add(article.url);
      allResults.push(article);
    }
  }

  // V2EX hot (disabled by default — content too generic)
  if (v2exLimit > 0) {
    const v2exResults = await fetchV2exHot(category, subcategory, v2exLimit);
    totalResults += v2exResults.length;
    for (const article of v2exResults) {
      if (existingUrls.has(article.url)) {
        dupes++;
        continue;
      }
      existingUrls.add(article.url);
      allResults.push(article);
    }
  }

  return { articles: allResults, totalResults, dupes };
}
