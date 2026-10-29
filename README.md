# daily-brief · AI-curated daily digest for Technical Artists & game pipelines

> A local-first news pipeline that turns **33 RSS / API sources** on games, Unreal Engine, DCC tools and *AI for 3D* into a **single self-contained HTML brief** — summarized by an LLM from a **Technical Artist's point of view**. Runs on your own machine via the OS scheduler, or in GitHub Actions with zero infrastructure.

**Technical Artists**, **VFX artists** and **procedural-content engineers** face a flood of cross-domain news: engine updates, DCC releases, new 3D-AI models, SIGGRAPH papers, toolchain resets. daily-brief filters and ranks that feed by *workflow impact*, not pageviews.

## Why this exists

Built and operated daily by an **AI Pipeline / Systems Technical Artist** (asset-preparation & procedural pipelines). The prompt set, source selection and importance-rating in this repo are the actual scanning signals used to stay ahead of the toolchain — not a demo wrapper around a generic RSS reader. The repository is deliberately small and inspectable: every prompt is plain text, every source is one JSON entry, no framework, no database.

## Pipeline

```text
33 sources (RSS/API/scrape)
  ├─ tech     → GitHub Trending · X-viral · AI media (TLDR, Latent Space, MIT TR, HF, TechCrunch …)
  ├─ games    → Unreal Blog · Real Time VFX · Tech-Artists.Org · 80LV · GDC · Blender · Neural4D …
  └─ research → arXiv cs.CV / cs.GR / cs.RO · HuggingFace daily papers · SIGGRAPH · ACM
        │
        ▼  parallel fetch (batched, per-source retry, 2-day staleness filter)
   LLM enrichment (pluggable backend)
        │  ─ per-subgroup batched summaries, TA-lens prompt
        ▼
   Daily Digest (Prompt B)  ── rank IMPORTANT/HIGH/MEDIUM by TA-workflow impact,
        │                      cross-domain findings, domain narrative
        ▼
   one self-contained HTML  (CSS/JS inlined, dark-mode, i18n zh/en)
        │
        └── email (Resend) · Windows Task Scheduler / launchd / cron · GitHub Pages
```

## Highlights

- **TA-lens ranking** — articles are rated by effect on a Technical Artist's workflow and toolchain, with cross-domain discoveries (e.g. robotics-sim → procedural generation, film pipeline → realtime) explained in TA terms.
- **Pluggable LLM backends** — one env var switches between Claude Code CLI, Anthropic, OpenAI-compatible (DeepSeek / MiniMax / Zhipu / self-hosted vLLM) and the generic `LLM_API_KEY` / `LLM_BASE_URL` aliases.
- **Every source is one JSON entry** — `sources.config.json` is the single source of truth; add / disable / re-categorize without touching code.
- **Zero API-key sources** — all feeds use free public endpoints; a Firecrawl search step is optional ~8 credits/day.
- **Local-first & private** — keys live in gitignored `.env.local`; latest report renders as a single HTML file you can email, scp, or archive.
- **i18n** — `REPORT_LOCALE=zh|en` switches sources, prompts, UI text and date format in one go.

## Quick start (local)

Requires Node 20+ and a git CLI; an LLM backend (default: Claude Code CLI, billed to your Max plan).

```bash
git clone https://github.com/<you>/daily-brief.git && cd daily-brief
npm install
cp .env.example .env.local        # then edit: pick a backend + set keys
npm run dry-run                   # fetch-only sanity check (~30s, no LLM)
npm run daily                     # full pipeline (~5-8 min)
npm run open                      # opens today's report
```

Schedule it daily with `node scripts/install.mjs [--at 08:00]` (Windows Task Scheduler / macOS launchd / Linux cron), or run it from a Claude Code session via the bundled `/run-daily` command.

## Run on GitHub Actions (zero infrastructure)

1. Push this repo, then in **Settings → Actions → General** enable workflows.
2. **Settings → Pages** → deploy from `gh-pages` / root.
3. Add a **secret** `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` / `MINIMAX_API_KEY`).
4. Set optional **variables**: `REPORT_HOUR=8`, `REPORT_TZ=Asia/Shanghai`, `REPORT_LOCALE=zh`, `LLM_MODEL=…`.
5. Trigger once manually from the Actions tab — the report is then live at `https://<you>.github.io/daily-brief/` and self-updates daily.

The workflow ships a time-zone aware gate (chosen hour in your TZ) with a catchup branch guarding against GitHub Actions silently dropping scheduled runs.

## Configuration

All knobs are documented in [`.env.example`](.env.example). Key ones:

| Var | What it does | Default |
|---|---|---|
| `LLM_BACKEND` | `claude-cli` / `anthropic` / `openai` / `deepseek` / `minimax` / `zhipu` | `claude-cli` |
| `LLM_API_KEY` + `LLM_BASE_URL` | generic aliases for any OpenAI/Anthropic-compatible endpoint | — |
| `REPORT_LOCALE` | `zh` or `en` — sources, prompts, UI all switch | `zh` |
| `REPORT_TZ` | IANA tz the report date follows | system local |
| `EMAIL_TO` | send each report as an HTML attachment (Resend key required) | — |
| `FIRECRAWL_API_KEY` | optional supplementary web search (+3-5 targeted queries/day) | — |

## Source layout

- **tech** — GitHub Trending, X-viral (AttentionVC leaderboard), AI media merged (HuggingFace, TLDR AI, Latent Space, MIT Tech Review, Creative Applications, TechCrunch).
- **games** — Unreal Engine Blog & YouTube, Real Time VFX, Tech-Artists.Org, 80 Level, GamesIndustry.biz, PC Gamer, Game Developer, NVIDIA Developer, Blender, GDC tech talks, Stefan 3D AI, Neural4D, fal.ai, Roboflow, Agent Reach (multi-platform discovery).
- **research** — arXiv cs.CV / cs.GR / cs.RO, HuggingFace daily papers (LLM/agent/3D/vision/generation keywords), ACM SIGGRAPH blog & YouTube.

Disabled entries stay in `sources.config.json` with a `notes` reason so the intent survives.

## Repository map for AI agents / contributors

- [`AGENTS.md`](AGENTS.md) — operational conventions for any coding agent (Claude Code, Codex, Cursor…). A Claude Code skill lives in [`.claude/skills/daily-brief/`](.claude/skills/daily-brief/) for the richest runtime experience.
- `lib/ai/daily-digest.ts` — **Prompt B**: the TA-lens daily digest generator (rank + narrative + cross-domain).
- `lib/ai/enrich.ts` — per-subgroup summarization prompts.
- `lib/sources/dispatch.ts` + `lib/sources/<id>.ts` — fetcher registry.
- `lib/output/render-newsnow-v2.ts` — HTML renderer (single-file, i18n, dark-mode).
- `scripts/` — `daily.ts` (pipeline), `dry-run.ts`, `regen-enrich.ts`, `build-site.mjs`, `install.mjs`, `deploy.mjs`, `quota-report.ts`.

## Screenshots

Drop renders into `docs/screenshots/` — the latest report is always at `daily_reports/<date>/<date>.html` after a run.

## License

MIT — see [LICENSE](LICENSE).

---

*Careers note: this is one artifact in an open engineering portfolio focused on AI×pipeline work: LLM-driven DCC/engine tooling, asset standardization, and evaluation-driven generation pipelines. Feedback and PRs welcome.*