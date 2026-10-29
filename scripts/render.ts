import "./_env";

import fs from "node:fs";
import path from "node:path";

import type { ArticleInput } from "../lib/ai/pipeline";
import type { DigestOutput } from "../lib/ai/daily-digest";
import { groupRaw } from "../lib/output/render";
import { renderHtml, renderMarkdown } from "../lib/output/render-newsnow-v2";
import { sources } from "../lib/sources/registry";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

/**
 * Re-render HTML + Markdown from a previously-saved daily report.
 *
 * Use this for UI-only iteration (CSS / layout / labels) — no RSS fetch,
 * no LLM call, no Max quota consumed. Requires that `npm run daily` has
 * been run for the target date so the sidecar `<date>-articles.json`
 * exists.
 *
 * Usage:
 *   npm run render              # today
 *   npm run render -- 2026-05-15  # specific date
 */
function loadDigest(date: string): DigestOutput | undefined {
  const file = path.join(OUTPUT_DIR, date, `${date}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`[render] digest JSON not found: ${file} — rendering without digest`);
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as DigestOutput;
}

function loadArticles(date: string): ArticleInput[] {
  const file = path.join(OUTPUT_DIR, date, `${date}-articles.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Articles sidecar not found: ${file}\n` +
        `Run \`npm run daily\` for ${date} first (or any date >= when sidecar was introduced).`,
    );
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
    articles: Array<
      Omit<ArticleInput, "publishedAt"> & { publishedAt?: string }
    >;
  };
  return data.articles.map((a) => ({
    ...a,
    publishedAt: a.publishedAt ? new Date(a.publishedAt) : undefined,
  }));
}

async function main() {
  const date = process.argv[2] || todayKey();
  console.log(`[render] re-rendering ${date} from cached data…`);

  const digest = loadDigest(date);
  const articles = loadArticles(date);
  console.log(`[render] loaded ${articles.length} articles${digest ? " + digest" : ""}`);

  const raw = groupRaw(articles, sources);
  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);
  fs.writeFileSync(`${base}.html`, renderHtml(raw, date, digest), "utf8");
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(date), "utf8");
    console.log(`[render] wrote ${base}.{html,md}`);
  } else {
    console.log(`[render] wrote ${base}.html`);
  }
}

main().catch((e) => {
  console.error("[render] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
