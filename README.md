# YouTube / YouTube Music Analytics

Local-first analytics dashboard for your Google Takeout YouTube & YouTube Music watch history. Everything runs in your browser - no data leaves your machine (with one opt-in exception documented below).

> **Live demo:** <https://raphvallee.github.io/YoutubeAnalytics/>

---

## What it does

Upload your `watch-history.json` from Google Takeout and explore what you've actually watched:

- 🎵 **Music dashboard** - top artists, favorite tracks, taste evolution over time, track eras, liked-music matching
- 📺 **Video dashboard** - top channels, peak viewing hours, day-of-week patterns, monthly trend, watch-time calendar heatmap
- 🌍 **World map** - where your favorite artists come from (birth/foundation place)
- 👍 **Liked music** - optional upload of your "Liked music / Liked videos" playlist exports, matched against your listening
- 📸 Snapshot compare - overlay a past dataset against the current one
- ⚡ PNG export - download any chart as an image

All data is stored locally in IndexedDB. Nothing is uploaded anywhere by default.

---

## Quick start

1. Go to <https://takeout.google.com/>, to get all your youtube data.
    1. Deselect all, select only "YouTube & YouTube Music".
    2. Click on "Multiple Formats", scroll down, go to "history" and select "JSON", click OK
    3. Click on "All YouTube data included" and deselect all except "history", click OK
    4. Click on Next and download your data once it is ready
2. Open the app at <https://raphvallee.github.io/YoutubeAnalytics/> (or run it locally - see below).
3. Drag & drop (or click to browse) your Takeout files on the **Import** page. Filenames do not matter: each file is identified by its contents, so a whole folder can go in at once. Files that are not watch history (search history, subscriptions) are reported and skipped; playlist exports are routed to likes.
4. Keep dropping files if you have more exports - each drop **adds to the same batch** instead of starting over, so you can assemble one import across several drags. Any file can be pulled back out with the `×` on its row. If several files share a name (every export contains a `watch-history.json`), the list numbers them by position - `watch-history.json`, `watch-history-2.json`, `watch-history-3.json` - and drops any file whose contents are identical to one already in the batch.
5. Check the list, then confirm. If you already have data imported you choose **Add to imported data** (default) or **Replace everything**. Replace saves a snapshot of the current dataset first.
6. Wait for the parse progress bar, then explore the **Music** or **Video** pages from the sidebar.

> **Adding exports from different dates:** every Takeout part is named `watch-history.json`, so exports taken months apart sit in separate folders. Import them one at a time with **Add** selected - rows are matched by time + video id, so re-importing the same export changes nothing and an older import is never lost. The choice is remembered between visits.

---

## Local development

```bash
# install
bun install --frozen-lockfile

# dev server (Vite)
bun run dev

# typecheck + build
bun run typecheck && bun run build

# tests (vitest)
bun run test

# e2e smoke (playwright)
bun run test:e2e

# lint + format check
bun run check

# optimization work: golden-output differ + A/B perf harness
bun run golden:setup   # snapshot HEAD analytics into a baseline (gitignored)
bun run golden         # verify current output matches the baseline
bun run bench:ab       # time current vs baseline over a 120k fixture
```

The built-in example data is served at `/dev/example-watch-history.json` (bundled in both dev and production builds) so you can click **Load example** on the Import page without uploading your own file.

CI gates every PR with lint, types, unit tests, and e2e (`.github/workflows/ci.yml`); merges to main deploy to GitHub Pages.

---

## Architecture

- **Framework:** Vite 8 + React 19 + TypeScript (strict), routing via react-router
- **Storage:** Dexie over IndexedDB (`navigator.storage.persist()` requested after import to prevent eviction)
- **Ingestion:** Web Worker classifies each file by content, parses + normalizes it, dedupes by `sha1(time + videoId)`, and commits the whole run to Dexie in one transaction (replace or additive upsert)
- **Analytics:** pure O(n) functions run in a dedicated Web Worker so the UI thread never blocks; the client caches results keyed by request + dataset generation - no query engine, no WASM
- **UI:** shadcn/ui (Base UI) + Tailwind CSS v4, dark-first; charts via Recharts; the world map renders with d3-geo over world-atlas TopoJSON; state via Zustand
- **Hosting:** GitHub Pages (static build, `base: '/YoutubeAnalytics/'`)

See [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the full design doc with locked decisions, data schema, and phased roadmap.

---

## Data traps handled

The real export has several quirks that this parser accounts for:

- **French locale titles** - `"Vous avez regardé Old Hundreds"` prefix stripping (locale-aware table covering more locales)
- **`"Release - Topic"` channels** - artist name stripped from these; artist extraction falls back to title parsing (`Artist - Track` shapes) with a confidence flag
- **`"Future - Topic"` channels** - artist extracted directly from the channel name
- **Non-breaking space in `"YouTube Music"` header** - normalized comparison so rows aren't missed
- **Zero search rows** in the reference export (searches aren't streams anyway)
- **Rows with no recoverable artist** - counted as unattributed, excluded from artist leaderboards and never ranked as channels

---

## Network calls (opt-in exceptions)

By default the app is fully offline. One user-approved network feature exists behind a toggle:

| Feature | Default | What it does |
| --- | --- | --- |
| **Artist-origin lookup** | **On** | MusicBrainz artist search + Open-Meteo geocoding for the world map; auto-starts as soon as a dataset is loaded, whatever page you're on; toggle on the Import page |

Every response is cached in IndexedDB with a 6-month refresh window, so ordinary use (reload, re-import, revisit) spends no requests. No other network calls are made.

---

## Project structure

```
src/
  analytics/   pure aggregation functions (queries, dashboard, heatmap, eras, likes) + the worker that runs them off the UI thread
  components/  shadcn wrappers, ChartCard, TimeFilterToolbar, leaderboards, SnapshotManager, LikesUpload
  db/          Dexie schema + dataset, likes, and snapshot CRUD
  ingestion/   worker + detect + normalize + titleParse + prefixes + likesParse
  lib/         format, palette, storage, iso, geo, geocode, mbArtist, musicbrainz, heat, mapZoom
  pages/       ImportView, MusicView, VideoView, MapWorldView (react-router routes)
  state/       zustand stores (dataset, filters, likes, snapshots, origins) + useAnalytics hook
  types/       shared type definitions
  test/fixtures/ sliced real-file fixtures
scripts/       golden-output differ + A/B perf harness for optimization work
tests/e2e/     Playwright smoke tests
```

---

*Built with [Vite](https://vitejs.dev), [Dexie](https://dexie.org), [Recharts](https://recharts.org)*
