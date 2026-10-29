---
name: daily-brief
description: Operational knowledge for the daily-brief digest pipeline (this project). RSS/API fetchers, pluggable LLM enrichment (default claude CLI on Max; also anthropic/openai/deepseek/minimax/zhipu API), TA-lens daily digest (Prompt B), HTML rendering, cross-platform scheduler integration (Windows Task Scheduler / macOS launchd / Linux cron). Load when the user asks about running daily / regenerating sections / debugging a failed run / adding or disabling sources / LLM quota / scheduler / why a tab shows wrong data / why a source failed / switching LLM backend. Always prefer the documented npm commands over re-implementing logic. Diagnose by reading logs/daily-*.log first, then logs/llm-calls.jsonl for LLM-side issues.
---

# daily-brief — Operational Skill

This project generates a single-page HTML news digest covering **AI+game+research news through a Technical Artist lens** (categories: game-news / game-tech / unreal-engine / ai-news / github-trending / x-viral / research). It runs via the OS scheduler (Windows Task Scheduler / macOS launchd / Linux cron, default 08:00 local time) and emits `daily_reports/<YYYY-MM-DD>/<YYYY-MM-DD>.html` + sidecar files. The date label uses the system local timezone by default — set `REPORT_TZ` (e.g. `Asia/Shanghai`, `UTC`) in `.env.local` to override. An optional email step (Resend) sends the HTML as an attachment.

Detailed architecture lives in code; this skill is a cheat sheet for **operating** and **diagnosing**, not a re-explanation of the system.

## Project root assumption

All paths in this skill are **relative to the project root** (the directory that contains `package.json`, `lib/`, `scripts/`).

**Before any command, ensure the working directory is the project root.** Two cases:

1. **Claude Code session opened inside the project** — already there, no action needed
2. **Session opened elsewhere** — read the config file and `cd`:

   ```bash
   # Cross-platform Node one-liner (prints the project root path):
   node -e "const fs=require('fs'),os=require('os'),path=require('path');const cfg=path.join(os.homedir(),'.daily-brief-config');if(fs.existsSync(cfg))console.log(fs.readFileSync(cfg,'utf8').trim());else process.exit(1)"
   ```

   Use the printed path: `cd "$(...)"` on bash / `Set-Location (...)` in PowerShell.

The config file is written by `node scripts/install.mjs --global`. If it's missing the user hasn't done a global install — tell them to run it.

## Quick command reference

| Need | Command | Cost |
|---|---|---|
| Full pipeline | `npm run daily` | ~5-8 min, ~20 LLM calls |
| Fetch sanity only (no LLM) | `npm run dry-run` | ~30s |
| Re-render existing sidecar | `npm run render [date]` | <1s |
| Top-up missing summary | `npm run regen-enrich <cat:sub> [date]` | ~20-40s, 1 LLM call |
| Open today's report in Chrome | `npm run open` | instant |
| LLM call usage + history | `npm run quota-report` | instant |

`[date]` defaults to today's date in the report timezone (system local, or `REPORT_TZ` if set). The pipeline and the OS scheduler both run in local time, so the report's date label = the date when the trigger fired in the report timezone.

`<cat:sub>` accepted by `regen-enrich`: matches the grouped enrichment passes — e.g. `games:game-tech`, `games:game-news`, `games:unreal-engine`, `tech:ai-news`. Single-source passes (GitHub Trending, X-viral, trending papers) are enriched as part of `daily` only — no top-up path.

## File map — where to change what

| Task | File |
|---|---|
| Add / disable / re-categorize a source | `sources.config.json` (project root — single source of truth; `lib/sources/registry.ts` is just a loader) |
| Rename L1 tab labels | `lib/output/render-newsnow-v2.ts` `TEXTS_ZH` (`catTech` / `catGames` / …) |
| Change per-source item cap | `SOURCE_DISPLAY_LIMITS` in `lib/output/render.ts` |
| Change merged-timeline cap | `MERGED_SUBGROUP_LIMITS` + `ENRICH_SUBGROUP_LIMITS` in `lib/output/render.ts` |
| Add an LLM enrichment prompt | `lib/ai/enrich.ts` — copy an existing `*_SYSTEM_PROMPT` pattern |
| Tune the daily digest | `lib/ai/daily-digest.ts` — `SYSTEM_PROMPT_DIGEST_B` (the TA-lens "Prompt B") |
| Wire an enrichment into pipeline | `scripts/daily.ts` — `await enrichXxx(articles)` in `main()` |
| Add a new fetcher type | New file in `lib/sources/` + branch in `lib/sources/dispatch.ts` |
| Adjust HTML styling | inline styles + template in `renderHtml()` of `lib/output/render-newsnow-v2.ts` |
| Change scheduler trigger time | `node scripts/install.mjs --at HH:MM` (re-registers) |
| Wrapper script the scheduler invokes | `scripts/run-daily.mjs` |

## How LLM enrichment works (mental model)

- **Each merged L2 subcategory gets one batched LLM pass**: e.g. `games:game-tech`, `games:game-news`, `games:unreal-engine`, `tech:ai-news`, plus single-source passes for GH-trending, X-viral, trending papers. Enrichment is sequential (parallel caused rate limits).
- Each pass = **one batched call** for all items in that subgroup. Don't iterate per-item.
- Sources with `lang: "zh"` in registry **skip** enrichment when `REPORT_LOCALE=zh` (already Chinese).
- Failures are non-fatal: skipped articles just render without `summary`.
- **Daily digest (Prompt B)** is a separate final call — reads `likes.md` if present for user-preference context + it boosts embodied-AI/simulation keywords so relevant articles survive truncation. Generates narrative, cross-domain discoveries, CRITICAL/HIGH/MEDIUM ranks, and per-domain (AI / game / art / research) views.

## Diagnostic flow

Order matters — top-to-bottom:

### "今天日报没出来" / "Chrome 没弹"
1. Check scheduled task state — platform-specific:
   - **Windows**: `Get-ScheduledTaskInfo -TaskName DailyBrief` → `LastRunTime` + `LastTaskResult` (`0`=success, `267009`=running, else failed)
   - **macOS**: `launchctl list | grep com.daily-brief` (PID column + last exit code)
   - **Linux**: cron doesn't track per-job state; look at `logs/cron.log`
2. Tail today's log (date = **local**, not UTC):
   ```bash
   node -e "const fs=require('fs'),d=new Date(),pad=n=>String(n).padStart(2,'0');console.log(fs.readFileSync('logs/daily-'+d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'.log','utf8').split('\n').slice(-40).join('\n'))"
   ```
3. Check report files exist: `ls daily_reports/<date>/` (any platform) or `Get-ChildItem daily_reports\<date>\` (Windows)

### "某个源数据不对 / 0 条"
1. Look at fetch lines near top of log — `<id> <count>` or `<id> FAILED — <reason>`
2. If specific source failed: read its fetcher in `lib/sources/<source>.ts`
3. If Cloudflare-related: see "LinuxDo lesson" below
4. Single-source failure must never kill the run (try/catch per source in `daily.ts`, 1 retry after 2s)

### "LLM 调用炸 / 中文摘要缺失"
1. `npm run quota-report` — per-backend summary; for `claude-cli` shows 5h window, for API backends shows 24h spending
2. If quota hot on `claude-cli`: wait or temporarily switch via `.env.local` (`LLM_BACKEND=openai` etc.)
3. If specific phase missing summaries: `npm run regen-enrich <cat:sub>`
4. Each call logged to `logs/llm-calls.jsonl` — grep `"success":false`, see `errorCategory` (`quota` / `timeout` / `auth` / `other`)
5. Which backend is active = `LLM_BACKEND` env in `.env.local`; not set → `claude-cli`
6. `validateBackendCredentials()` fails fast before fetching, if the backend has no credentials/can't be reached.

### "UI 出错 / 某个 tab 显示异常"
1. `npm run render` (1 second) — often fixes display-only bugs
2. If still wrong: read rendered HTML for the affected panel
3. `renderRawCategoryPanel` / tab wiring live in `render-newsnow-v2.ts`

## Recurring failure patterns (institutional knowledge)

### LinuxDo / Cloudflare WAF
- LinuxDo is behind Cloudflare and frequently flags datacenter-IP exits with "Just a moment..." challenges
- **Do NOT add aggressive retry to its fetcher** — burst requests escalate the WAF flag, causing persistent blocks
- May ship with `enabled: false` depending on current IP reputation
- If re-enabling: keep single attempt, accept intermittent failures

### Run-daily.mjs wrapper notes
- Tees `npm run daily` stdout+stderr to `logs/daily-<local-date>.log` via stream pipes (real-time, not buffered)
- Exit code from `npm run daily` is propagated to the OS scheduler
- On exit 0: spawns `npm run open` detached so Chrome opens without blocking
- Cross-platform: same `.mjs` file works on Windows / macOS / Linux

### "X 推文 出现非英文"
- API's `lang=en` param is best-effort; some slip through
- Fix in `lib/sources/attentionvc.ts` `isEnglish()` — checks `langsDetected` (most reliable) + `lang === "zxx"` (image/code-only, kept)

### "社区讨论 tab 偶发空白"
- Was a JS scope bug: sub-tab/source-tab handlers used `data-cat="tech"` selector. Tech main panel AND community panel both had sub-content with `data-cat="tech"`, so clicking AI 媒体 in tech panel deactivated cn-community in community panel
- Fixed: handlers use `btn.closest('.panel')` + `btn.closest('.sub-content')`. If regression, look at inline `<script>` block at end of `renderHtml()`

### Daily digest (Prompt B) JSON flakiness
- Digest generation fails ~sometimes (long JSON, larger models). `daily.ts` retries once automatically; if both fail the report still renders without the digest block
- `lib/ai/daily-digest.ts` uses `extractJson` + `jsonrepair` recovery, same pattern as `enrich.ts`
- `timeoutMs: 180_000` — long JSON generation may need extra time; raise if you hit third-party timeouts

## Source registry conventions

Sources live in [`sources.config.json`](sources.config.json) at the project root. `lib/sources/registry.ts` only loads + validates that JSON at module-init; never hardcode sources in TS.

- Every source has: `id`, `name`, `type` (`rss`/`api`/`scrape`), `url`, `category`, `subcategory?`, `enabled?`, `useCurl?`, `lang?`, `locales?`
- `useCurl: true` for sources behind Cloudflare-style TLS-fingerprint blocks
- `lang: "zh"` (or "en") for sources already in a specific language — enrich skips them when REPORT_LOCALE matches
- `locales: ["zh"|"en"]` filters which REPORT_LOCALE keeps the source. Omit → both
- Disabled sources stay in the JSON with `enabled: false` + a `notes` field explaining why — don't delete
- Run `npm run sources` to see the table by category with current enable/filter status

## Render layout (current)

L1 tabs: `tech / games / game-tech / research / community`

```
AI技术新闻 (tech)
  L2: GitHub Trending  (per-source, cap 7)
  L2: X 推文           (single source attentionvc-ai, cap 20, preserve fetch order)
  L2: AI 媒体          (merged RSS: HF, TLDR, Latent Space, MIT TR, Creative Apps, TechCrunch)

游戏新闻 (games)          merged game-news timeline (80LV, GamesIndustry, PC Gamer, Game Developer)
游戏技术 (game-tech)      merged: NVIDIA, Blender, GDC, fal.ai, Roboflow, Neural4D, Agent Reach discovery
  └─ Unreal Engine (unreal-engine)  Unreal Blog, Real Time VFX, Tech-Artists.Org, Tom Looman, William Faucher, Ben Cloward, Unreal YT

前沿研究 (research)        merged: arXiv CV/GR/RO, HF trending papers, SIGGRAPH blog+YT

社区讨论 (community)
  Source tabs: V2EX / LinuxDo (cap 10 each)
```

## Scheduler integration (cross-platform)

`scripts/install.mjs` registers the daily trigger via the OS-native scheduler:

| OS | Mechanism | Wake-from-sleep |
|---|---|---|
| Windows | Task Scheduler "DailyBrief" (`WakeToRun`, `AllowStartIfOnBatteries`, `StartWhenAvailable`) + power-plan wake timers | ✓ wakes laptop |
| macOS | launchd plist `~/Library/LaunchAgents/com.daily-brief.plist` | ✗ doesn't wake; configure `pmset` separately if needed |
| Linux | crontab entry tagged `# daily-brief` | ✗ cron doesn't fire while suspended — run skipped |

Common:
- Default trigger: **08:00 local time** (`--at HH:MM` to change)
- Runs as current interactive user — required because claude CLI's OAuth token lives in user profile
- Execution timeout: 30 min (Windows only; macOS/Linux no built-in timeout)
- Set up: `node scripts/install.mjs [--at HH:MM] [--global]`
- Tear down: `node scripts/uninstall.mjs`
- Inspect: `Get-ScheduledTask DailyBrief | fl` or `taskschd.msc` GUI

## What NOT to do

- Don't `console.log` debugging that won't survive — use structured logger or write to `logs/`
- Don't add `process.exit(1)` deep in a fetcher; let `daily.ts`'s per-source try/catch handle it
- Don't bypass `runLlm` (lib/ai/llm.ts) by importing a specific backend directly — that defeats the LLM_BACKEND switch and pins call sites to one provider
- Don't change the default backend silently; if user has Max subscription they almost certainly want `claude-cli` to keep using it. Switching to API costs them money
- Don't add Playwright / Puppeteer dependencies casually — project uses curl + JSON APIs to stay light