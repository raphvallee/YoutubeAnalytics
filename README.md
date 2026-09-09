# YouTube / YouTube Music Analytics

Local-first analytics dashboard for your Google Takeout YouTube & YouTube Music watch history. Everything runs in your browser - no data leaves your machine (with two opt-in exceptions documented below).

> **Live demo:** <https://raphvallee.github.io/YoutubeAnalytics/>

---

## What it does

Upload your `watch-history.json` from Google Takeout and explore what you've actually watched:

- 🎵 **Music dashboard** - top artists, favorite tracks, taste evolution over time, track eras, releases (MusicBrainz-enriched)
- 📺 **Video dashboard** - top channels, peak viewing hours, day-of-week patterns, monthly trend, watch-time calendar heatmap
- 🌍 **World map** - where your favorite artists come from (birth/foundation place)
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
3. Drag & drop (or click to browse) your `watch-history.json` on the **Import** page.
4. Wait for the parse progress bar, then explore the **Music** or **Video** tabs.

> The import replaces the current dataset entirely (simplest correct semantics for a replaceable snapshot). Incremental merge is planned.

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
```

The built-in example data is served at `/dev/example-watch-history.json` (bundled in both dev and production builds) so you can click **Load example** on the Import page without uploading your own file.

---

## Architecture

- **Framework:** Vite 8 + React 19 + TypeScript (strict)
- **Storage:** Dexie over IndexedDB (`navigator.storage.persist()` requested after import to prevent eviction)
- **Ingestion:** Web Worker parses + normalizes `watch-history.json` in ≤100MB chunks, dedupes by `sha1(time + videoId)`, bulk-inserts into Dexie
- **Analytics:** pure O(n) functions over in-memory arrays, memoized by filter key - no query engine, no WASM
- **UI:** shadcn/ui + Tailwind CSS v4, dark-first; charts via Recharts; state via Zustand
- **Hosting:** GitHub Pages (static build, `base: '/YoutubeAnalytics/'`)

See [`docs/BLUEPRINT.md`](docs/BLUEPRINT.md) for the full design doc with locked decisions, data schema, and phased roadmap.

---

## Data traps handled

The real export has several quirks that this parser accounts for:

- **French locale titles** - `"Vous avez regardé Old Hundreds"` prefix stripping (locale-aware table)
- **`"Release - Topic"` channels** - artist name stripped from these; artist extraction falls back to title parsing (`Artist - Track` shapes) with a confidence flag
- **`"Future - Topic"` channels** - artist extracted directly from the channel name
- **Non-breaking space in `"YouTube Music"` header** - normalized comparison so rows aren't missed
- **Zero search rows** in this export (searches aren't streams anyway)
- **573 music rows with no recoverable artist** - counted as unattributed, excluded from artist leaderboards

---

## Network calls (opt-in exceptions)

By default the app is fully offline. Two user-approved network features exist behind toggles:

| Feature | Default | What it does |
| --- | --- | --- |
| **Artist-origin lookup** | **On** | MusicBrainz artist search + Open-Meteo geocoding for the world map; auto-starts on map open; toggle in Import page |

Every response is cached in IndexedDB so each entity is queried at most once. No other network calls are made.

---

## Project structure

```
src/
  analytics/   pure aggregation functions (top artists, series, summaries)
  components/  shadcn wrappers, ChartCard, TimeFilterToolbar, leaderboards
  db/          Dexie schema + dataset CRUD
  ingestion/   worker + normalize + titleParse + prefixes
  lib/         format, palette, storage, iso, geo, mbArtist, geocode, heat, mapZoom
  pages/       ImportView, MusicView, VideoView, MapWorldView
  state/       zustand stores (dataset, filters, likes, snapshots, origins)
  test/fixtures/ sliced real-file fixtures
```

---

*Built with [Vite](https://vitejs.dev), [Dexie](https://dexie.org), [Recharts](https://recharts.org)*
