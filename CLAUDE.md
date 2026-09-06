# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first analytics web app for Google Takeout YouTube / YouTube Music exports (`watch-history.json`). Everything runs in the browser — **the app must never make external API calls**. `docs/BLUEPRINT.md` is the governing design doc with locked decisions, data-schema analysis, and a phased roadmap. Read its §0 (locked decisions) and §5 (phases) before starting work.

### Workflow rules

- **Always use the `milestone-completion` skill** when implementing or verifying blueprint phases; check off items in `docs/BLUEPRINT.md` §5 as they are completed, with evidence.
- Package manager is **Bun**, never npm/yarn/pnpm.
- Hosting is GitHub Pages (project site at `https://raphvallee.github.io/YoutubeAnalytics/`), deployed via `.github/workflows/deploy.yml`.

## Commands

```bash
bun install            # install (frozen lockfile in CI)
bun run dev            # Vite dev server
bun run typecheck      # tsc -b (also runs as part of build)
bun run test           # vitest run (all tests)
bunx vitest run src/lib/storage.test.ts   # single test file
bun run test:e2e       # Playwright smoke (needs `bunx playwright install chromium` once)
bun run check          # Biome lint + format + import organization check
bun run format         # Biome format --write
bun run build          # typecheck + vite build (CI gate = check + typecheck + test + build)
bun run preview        # serve dist/ locally
```

## Critical constraints

- **Base path rule**: every URL is basename-relative. Vite `base: '/YoutubeAnalytics/'` in `vite.config.ts` and `<BrowserRouter basename={import.meta.env.BASE_URL}>` in `src/main.tsx` must stay in sync. Never hardcode absolute paths (`/music`, `/favicon.svg`) — they 404 on Pages.
- **`watch-history.json` in the repo root is real personal data** — gitignored, never commit it or any fixture derived from a full real file without asking. Test fixtures should be small grep-selected slices.
- **Biome excludes `public/` and `*.css`** — its CSS parser rejects Tailwind v4 at-rules (`@custom-variant`, `@theme inline`, `@apply`). Do not remove these exclusions.
- TypeScript is strict + `noUncheckedIndexedAccess`, TS 6 (no `baseUrl` — it errors; use `paths` alone).
- Biome enforces tabs + double quotes; run `bun run format` before committing.

## Architecture

Three-layer SPA (Vite 8 + React 19 + TS):

1. **Ingestion** (Phase 1, `src/ingestion/` — not yet built): Web Worker parses Takeout JSON (`File.text()` + `JSON.parse`; ≤100MB ceiling, no streaming parser yet), normalizes to `StreamRecord`, dedupes by `sha1(time + videoId)`, bulk-inserts into Dexie (IndexedDB). Normalization details in BLUEPRINT §2 — including locale-prefix stripping (`"Vous avez regardé X"` — the real export is French) and the `"Release - Topic"` artist trap.
2. **Storage** (`src/db/` — not yet built): Dexie tables `streams` + `meta`. Data persists across sessions; `navigator.storage.persist()` (probed in `src/lib/storage.ts`) prevents eviction. On startup the whole dataset loads into memory; all aggregations are pure O(n) passes in `src/analytics/` (planned) memoized by filter key — no query engine, no WASM (dataset is ~56k rows / ≤100MB).
3. **UI**: `src/pages/` — three routes (`/music`, `/overview`, `/import`) with a sidebar (`src/App.tsx`). shadcn/ui v4 (base-ui flavor) + Tailwind v4, dark-mode-first. Charts: Recharts. Shared time-filter state: Zustand store (planned).

Blueprint phases 0–1 are done/next; `src/lib/storage.ts` and the route shell are Phase 0 output. Future phases add `src/analytics/`, `src/state/`, `src/db/`, `src/ingestion/`.
