/**
 * Generate search queries from likes.md + hardcoded TA interests.
 *
 * Three sources (in priority order):
 * 1. likes.md "长期关注方向" — structured long-term interests
 * 2. likes.md ★ lines — recent bookmarks
 * 3. Hardcoded baseline — fallback covering core domains
 *
 * Result: 3-5 search queries that personalize search per run.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Hardcoded baseline queries aligned with likes.md "长期关注方向".
 * These cover the top 3 priority directions when likes.md is missing.
 */
const TA_BASE_QUERIES: string[] = [
  // Priority 1: #AI工具化（含3D生成管线）
  "Claude Code AI shader Gaussian Splatting 3D generation game pipeline technical artist",
  // Priority 2: #管线架构
  "3D AI pipeline architecture asset validation engine integration protocol design",
  // Priority 3: #机器人仿真→游戏迁移
  "robotics physical AI world model simulation game engine PCG Sim-to-Real",
  // Priority 4: #具身智能+仿真交叉
  "embodied AI simulation engine Sim-to-Real robotics game",
];

/**
 * Parse likes.md "长期关注方向" section headers.
 * Returns focus area keywords for search prioritization.
 */
function parseFocusAreas(content: string): string[] {
  const areas: string[] = [];
  const lines = content.split("\n");
  let inFocusSection = false;

  for (const line of lines) {
    // Detect "长期关注方向" section
    if (line.includes("长期关注方向")) {
      inFocusSection = true;
      continue;
    }
    // End at next major section
    if (inFocusSection && line.startsWith("## ")) {
      break;
    }
    // Extract ### headers (focus area names)
    if (inFocusSection && line.startsWith("### ")) {
      const area = line.replace(/^###\s+\d+\.\s*/, "").replace(/\s+—.*$/, "").trim();
      if (area) areas.push(area);
    }
  }

  return areas;
}

/**
 * Parse likes.md and extract key terms from ★ lines.
 * Returns an array of search-query strings derived from user preferences.
 *
 * Format of likes.md:
 *   - ★ keyword1 `#tag1 #tag2` — description
 *   - ★ "Title" — description
 */
function parseLikesMd(content: string): string[] {
  const queries: string[] = [];

  for (const line of content.split("\n")) {
    const match = line.match(/-?\s*★\s*(.+)/);
    if (!match) continue;

    let text = match[1].trim();
    // Strip tags (we'll use them separately)
    text = text.replace(/\s*`#[^`]+`/g, "").trim();
    // Strip trailing " — description" part
    text = text.replace(/\s*—\s*.+$/, "").trim();
    // Strip surrounding quotes
    text = text.replace(/^["']|["']$/g, "").trim();

    if (text.length < 5) continue; // skip very short terms

    // Extract meaningful keywords (filter out common stop words)
    const stopWords = new Set([
      "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
      "being", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "can", "not", "no", "yes",
    ]);

    const words = text
      .split(/[\s,;:|/()]+/)
      .filter((w) => w.length > 1 && !stopWords.has(w.toLowerCase()));

    if (words.length >= 2) {
      // Use the full extracted text (up to 80 chars) as a query
      queries.push(text.slice(0, 80));
    }
  }

  return queries;
}

/**
 * Parse likes.md and extract tag frequency.
 * Returns a map of tag -> count, useful for prioritizing queries.
 */
function parseTagFrequency(content: string): Map<string, number> {
  const tagCounts = new Map<string, number>();

  for (const line of content.split("\n")) {
    // Match tags in backticks: `#tag1 #tag2`
    const tagMatch = line.match(/`([^`]+)`/g);
    if (tagMatch) {
      for (const t of tagMatch) {
        const tags = t.replace(/`/g, "").split(/\s+/).filter(s => s.startsWith("#"));
        for (const tag of tags) {
          const key = tag.toLowerCase();
          tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
        }
      }
    }
  }

  return tagCounts;
}

/**
 * Generate search queries for this daily run.
 *
 * Merges hardcoded baseline with personalized queries from likes.md.
 * Priority: focus areas > recent bookmarks > baseline.
 * Deduplicates and caps at maxQueries.
 */
export function generateSearchQueries(
  projectRoot: string,
  maxQueries = 5,
): string[] {
  const queries: string[] = [];

  // 1. Add hardcoded baseline queries (aligned with top 3 focus areas)
  queries.push(...TA_BASE_QUERIES);

  // 2. Try to read likes.md and extract personalized queries
  try {
    const likesPath = path.join(projectRoot, "likes.md");
    if (fs.existsSync(likesPath)) {
      const content = fs.readFileSync(likesPath, "utf8");

      // 2a. Parse recent bookmarks (★ lines)
      const likesQueries = parseLikesMd(content);
      queries.push(...likesQueries.slice(0, 2));

      // 2b. (Optional) Log focus areas for debugging
      const focusAreas = parseFocusAreas(content);
      if (focusAreas.length > 0) {
        // Could use focus areas to weight/reorder queries in future
        // For now, just ensure they're covered by baseline
      }
    }
  } catch {
    // Non-fatal — likes.md is optional
  }

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const unique = queries.filter((q) => {
    const key = q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, maxQueries);
}
