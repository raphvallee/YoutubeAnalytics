# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first analytics web app for Google Takeout YouTube / YouTube Music exports (`watch-history.json`). Everything runs in the browser - **no external API calls except one user-approved network feature** (Phase 7 artist-origin lookup via MusicBrainz + Open-Meteo geocoding), behind a toggle and cached locally. `docs/BLUEPRINT.md` is the governing design doc with locked decisions, data-schema analysis, and a phased roadmap. Read its §0 (locked decisions) and §5 (phases) before starting work.

### Workflow rules

- **Always use the `milestone-completion` skill** when implementing or verifying blueprint phases; check off items in `docs/BLUEPRINT.md` §5 as they are completed, with evidence.
- **Bun is the only package manager and runner - NEVER use npm for anything.** No `npm install`, no `npm run`, no `npx` - always `bun install`, `bun run`, `bunx`. Never npm/yarn/pnpm.
- Hosting is GitHub Pages (project site at `https://raphvallee.github.io/YoutubeAnalytics/`), deployed via `.github/workflows/deploy.yml`.
- Pull requests are gated by `.github/workflows/ci.yml` (two jobs: check/typecheck/test/build, then the Playwright smoke against that build). Add new gates there, not only in `deploy.yml`.

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
bun run build          # typecheck + vite build (CI gate = check + typecheck + test + build, plus test:e2e on PRs)
bun run preview        # serve dist/ locally
```

## Critical constraints

- **Base path rule**: every URL is basename-relative. Vite `base: '/YoutubeAnalytics/'` in `vite.config.ts` and `<BrowserRouter basename={import.meta.env.BASE_URL}>` in `src/main.tsx` must stay in sync. Never hardcode absolute paths (`/music`, `/favicon.svg`) - they 404 on Pages.
- **`watch-history.json` in the repo root is real personal data** - gitignored, never commit it or any fixture derived from a full real file without asking. Test fixtures should be small grep-selected slices.
- **Biome excludes `public/` and `*.css`** - its CSS parser rejects Tailwind v4 at-rules (`@custom-variant`, `@theme inline`, `@apply`). Do not remove these exclusions.
- TypeScript is strict + `noUncheckedIndexedAccess`, TS 6 (no `baseUrl` - it errors; use `paths` alone).
- Biome enforces tabs + double quotes; run `bun run format` before committing.

## Architecture

Three-layer SPA (Vite 8 + React 19 + TS):

1. **Ingestion** (Phase 1, `src/ingestion/`): Web Worker parses Takeout JSON (`File.text()` + `JSON.parse`; ≤100MB ceiling, no streaming parser yet), normalizes to `StreamRecord`, dedupes by `sha1(time + videoId)`, bulk-inserts into Dexie (IndexedDB). Normalization details in BLUEPRINT §2 - including locale-prefix stripping (`"Vous avez regardé X"` - the real export is French) and the `"Release - Topic"` artist trap.
2. **Storage** (`src/db/`): Dexie tables `streams` + `meta` (+ likes / snapshots / artistOrigins). Data persists across sessions; `navigator.storage.persist()` (probed in `src/lib/storage.ts`) prevents eviction. Aggregations are pure O(n) passes in `src/analytics/` - no query engine, no WASM (dataset is ~56k rows / ≤100MB).
3. **UI**: `src/pages/` - four routes (`/music`, `/video`, `/map`, `/import`) with a sidebar (`src/App.tsx`). shadcn/ui v4 (base-ui flavor) + Tailwind v4, dark-mode-first. Charts: Recharts. Shared time-filter state: Zustand store (planned).

**Analytics run in a worker, not on the UI thread** (Phase 9). Pages get their numbers through `useAnalytics` (`src/state/useAnalytics.ts`) from the analytics worker (`src/analytics/analytics.worker.ts`), which owns the dataset and reads IndexedDB itself - never add a `useMemo` that scans `records`, or a `records`-driven component prop, or page navigation blocks the thread for hundreds of ms at real dataset sizes. The dataset store still keeps `records` in memory, but only for what genuinely needs rows on the UI thread (snapshot saves, origins ranking). Every request in `src/analytics/protocol.ts` must survive `structuredClone`.

Blueprint phases 0-9 are implemented. Read `docs/BLUEPRINT.md` §5 for what each phase covers and why.
