# YouTube / YouTube Music Analytics - Technical Blueprint

Version: 1.0 · 2026-09-05
Status: Approved plan (all decisions locked via stakeholder Q&A)

---

## 0. Locked Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Framework | **Vite + React 19 + TypeScript (strict)** | Static SPA for GitHub Pages; no SSR value for a local-analytics tool |
| Package manager | **Bun** | Required |
| Query/storage engine | **IndexedDB via Dexie + `navigator.storage.persist()`** | Real dataset is 23.5MB / 56,300 rows (ceiling 100MB). DuckDB-Wasm (~2-4MB WASM) is dead weight; plain JS aggregation over in-memory arrays is single-digit milliseconds. See §1.3 persistence semantics |
| Charting | **Recharts** | Line/area/stacked-area + brush natively; React-idiomatic |
| UI kit | **shadcn/ui + Tailwind CSS v4** | Dark-mode-first dashboards, copy-paste component ownership |
| Hosting | **GitHub Pages via GitHub Actions** | Static build, `base: '/<repo>/'` |
| Likes data | **Optional playlist file upload** | `watch-history.json` contains zero like data (verified). "Liked music" lives in playlist export - user uploads it separately |
| Album analytics | **Title-parsing + local grouping only** | No album metadata exists anywhere in Takeout; external enrichment rejected for privacy. See §2.5 |
| External API calls | **None, ever** *(one user-approved exception: Phase 7 artist-origin lookup - MusicBrainz artist search + Open-Meteo geocoding - on by default per explicit user decision, auto-starts on map open, toggleable; every response cached locally)* | 100% local-first by default; the only network feature is the explicitly toggled enrichment |

**Ground-truth data profile** (from the real `watch-history.json` in repo root):

- 56,300 entries · 39,744 `header: "YouTube Music"` · 16,556 `header: "YouTube"`
- Export locale is **French**: titles look like `"Vous avez regardé Old Hundreds"` - prefix stripping must be locale-aware
- Artist channel names come as auto-generated Topic channels: `"Future - Topic"`, `"YC Worldwide - Topic"`
- **Critical trap found in real data**: many music entries have channel `"Release - Topic"` - YouTube strips the artist name from these channels. Artist extraction MUST have a title-based fallback and a confidence flag
- `titleUrl` uses `=` escape for `=` (JSON.parse decodes this automatically; never regex the raw file)
- Timestamps are ISO-8601 UTC with milliseconds: `"2026-09-05T23:38:26.018Z"`

---

## 1. System Architecture & Tech Stack

### 1.1 Stack

| Layer | Technology |
| --- | --- |
| Build | Vite 6 + `@vitejs/plugin-react` |
| Language | TypeScript 5.x, `strict: true` |
| UI | React 19, shadcn/ui, Tailwind CSS v4 |
| Charts | Recharts 2.x |
| State | Zustand (UI/global filter state) + TanStack Query not needed (no server) |
| DB | Dexie 4 (IndexedDB wrapper), Dexie React hooks (`useLiveQuery`) |
| Parsing | Web Worker (DedicatedWorkerGlobalScope) |
| IDs/hashing | native `crypto.subtle.digest('SHA-1')` in worker |
| Dates | date-fns (tree-shakeable, no moment) |
| Tests | Vitest (unit) + Playwright (smoke) |
| Lint/format | Biome (fast, single binary) |
| CI/CD | GitHub Actions → Pages |

### 1.2 Runtime architecture (data flow)

```
┌─ Main thread ──────────────────────────────────────────────┐
│  React SPA                                                 │
│  ├─ ImportView        (dropzone, progress, dataset meta)   │
│  ├─ MusicView         (leaderboards, affinity, eras)       │
│  ├─ VideoView      (general YouTube analytics)          │
│  └─ Zustand store ──── time-filter toolbar (shared)        │
│         │                                                  │
│         ▼ useLiveQuery (Dexie)                             │
└─────────┼──────────────────────────────────────────────────┘
          │ postMessage(file blobs)
┌─────────▼─ Web Worker (ingestion.worker.ts) ───────────────┐
│  1. File.text()  (≤100MB OK; streaming fallback §1.4)      │
│  2. JSON.parse → RawTakeoutEntry[]                         │
│  3. normalize()  per entry → StreamRecord                  │
│  4. dedupe (Set of hash(time+videoId))                     │
│  5. bulkPut into Dexie in 5k-row transactions              │
│  6. postMessage({progress, stats})                         │
└────────────────────────────────────────────────────────────┘
```

Key properties:

- **No network after load.** Everything below the CDN boundary is local computation.
- **Worker isolation.** Parsing never blocks the main thread; UI stays interactive, progress bar driven by worker messages.
- **Query pattern.** On app start, load all `StreamRecord`s from IndexedDB into in-memory typed arrays (~56k rows ≈ 6MB RAM; 100MB file ≈ 25MB RAM). All aggregations are pure functions over these arrays, memoized by `(filterKey)` with `useMemo`. No index round-trips per interaction.

### 1.3 IndexedDB persistence semantics (asked explicitly)

IndexedDB is **persistent origin storage**, not session storage:

- **Survives:** tab close, browser restart, OS reboot. Data lives in the browser profile on disk.
- **Cleared only by:** user clearing site data ("Clear browsing data → Cookies and site data" for this origin), DevTools "Clear storage", or uninstalling/cleaning the browser profile.
- **Eviction risk:** browsers may evict storage under disk pressure via LRU *unless* the origin is marked persistent. We call `navigator.storage.persist()` right after first import - once granted (user has imported data / engaged with the site), Chrome/Firefox will not evict us.
- **Quota:** granted from a per-origin pool (typically large fractions of free disk; Chrome asks for more than ~60% via the persistent-storage prompt). 100MB is far below any real quota.
- **Safari note:** Safari historically used 7-day ITP deletion for script-writable storage when the site is not added to the home screen. Mitigation: the "Export dataset" button (§2.6) lets the user snapshot the parsed dataset to a file. Document this in Settings.

`navigator.storage.estimate()` is surfaced in Settings (used quota, quota total, persisted: yes/no).

### 1.4 Parsing multi-100MB JSON without crashing the thread

Scaling story, in order of what we actually do:

1. **≤ 100MB (our ceiling, 23.5MB today): `File.text()` + `JSON.parse` inside the Worker.** 100MB file → ~2-4s parse, transient memory ~4-6× file size (still < 1GB worst case). Progress is reported per-phase (read → parse → normalize → persist), not per-row. This is the implemented path.
2. **> 100MB (defensive path, same worker): chunked streaming parse.** Read the file as `Blob.slice()` chunks, split on top-level object boundaries by scanning for `},{` outside string literals, parse each fragment with `JSON.parse('[' + frag + ']')`, normalize, then free. Constant-ish memory, progress per chunk. Ship only if a user actually hits the ceiling - the interface (`normalize(chunk): Promise<void>`) is identical either way.
3. **Never:** `response.json()` on the main thread, regex over raw bytes, or any sync parse on the UI thread.

Google Takeout splits histories into multiple files (`watch-history(1).json`, …) above ~1GB. The dropzone accepts **multiple files** and merges them; dedupe by `hash(time + videoId)` makes overlap harmless.

### 1.5 GitHub Pages specifics

- Vite `base: '/YoutubeAnalytics/'` (repo name) - set once in `vite.config.ts`; switchable via env for custom-domain deploys.
- Router must mirror it: `<BrowserRouter basename={import.meta.env.BASE_URL}>` in `src/main.tsx` - otherwise deep links like `/YoutubeAnalytics/music` redirect to a broken bare `/music`. Every URL the app emits must be basename-relative; never hardcode absolute paths.
- SPA is single-route; no 404 rewrite needed. Still add `404.html` = copy of `index.html` as belt-and-braces.
- Actions workflow: `oven-sh/setup-bun` → `bun install --frozen-lockfile` → `bun run typecheck && bun run test && bun run build` → upload `dist/` → `actions/deploy-pages`.
- WASM-free build ⇒ no special headers, COEP/COOP not required.

---

## 2. Data Parsing & Normalization Schema

### 2.1 Raw Takeout entry (as observed in the real file)

```ts
/** Exactly what Google emits. Fields other than `header/title/titleUrl/subtitles/time`
 *  are ignored at parse time. Optional fields are genuinely optional. */
export interface RawTakeoutEntry {
  header: string;                    // "YouTube" | "YouTube Music" | e.g. "YouTube and YouTube Music" in some exports
  title: string;                     // locale-prefixed: "Vous avez regardé X", "Watched X", "Angesehen: X"
  titleUrl?: string;                 // absent when the video was deleted
  subtitles?: Array<{
    name?: string;                   // "Future - Topic", "Release - Topic", plain channel names
    url?: string;                    // channel URL - channelId = substring after "/channel/"
  }>;
  time: string;                      // ISO-8601 UTC
  products?: string[];
  activityControls?: string[];
  details?: Array<{ name: string }>; // e.g. "From Google Ads" - excluded from organic analytics
}
```

### 2.2 Normalized record (persisted)

```ts
export type StreamKind = 'music' | 'youtube';
export type ArtistConfidence = 'topic' | 'parsed' | 'unknown';

export interface StreamRecord {
  id: string;               // SHA-1(`${time}::${videoId ?? titleUrl ?? title}`) hex - also the dedupe key
  ts: number;               // epoch ms from `time`; invalid dates → record dropped + counted
  kind: StreamKind;
  videoId: string | null;   // from titleUrl `?v=` param; null when unparseable/deleted
  title: string;            // cleaned title: locale prefix stripped, decorations removed (§2.4)
  rawTitle: string;         // untouched Takeout title, for audit/debug
  artist: string | null;    // canonical artist display name, may be null
  artistKey: string;        // lowercase-trimmed normalization key for grouping ('' if no artist)
  artistConfidence: ArtistConfidence;
  channel: string | null;   // raw subtitle[0].name
  channelId: string | null; // from channel URL
  adDriven: boolean;        // details contains "From Google Ads" → excluded from "organic" filters
}
```

Dexie stores (v1):

```ts
class AnalyticsDB extends Dexie {
  streams!: Table<StreamRecord, string>;
  meta!: Table<DatasetMeta, 'dataset'>;
}
// .stores(): 'streams: id, ts, kind, artistKey, videoId, [kind+ts], [artistKey+ts]'
// meta: { key:'dataset', importedAt, fileCount, rowCount, musicCount, minTs, maxTs, schemaVersion }
```

Re-import policy (amended Phase 8): a single `rw` transaction commits the whole run, in one of two modes chosen at import time - `replace` clears then bulkPuts, `add` upserts by row id. Idempotent and last-writer-wins on id collision, so exports taken months apart layer without duplicating and a fresher export corrects titles/ad flags Takeout rewrote in place. In `add` mode the meta aggregates are recomputed from the merged table, not delta-ed onto the stored ones.

### 2.3 Domain separation (music vs standard YouTube)

Strict precedence, first match wins:

1. `header === 'YouTube Music'` → music
2. `titleUrl` host is `music.youtube.com` → music
3. otherwise → youtube

(`header: "YouTube and YouTube Music"` appears in some older exports; rule 2 then decides per-entry. Anything else defaults to youtube - under-classification is safer than over-.)

### 2.4 Title cleaning + artist extraction pipeline

Per entry, in order:

1. **Locale prefix strip.** Match `rawTitle` against a known-prefix table and keep the remainder:

   ```ts
   const TITLE_PREFIXES = [
     'Vous avez regardé ',  // fr
     'Watched ',            // en
     'Angesehen: ',         // de
     'Viste ',              // es
     'Visualização de ',    // pt
     'Hai guardato ',       // it
     '查看了 ',              // zh
   ] as const;
   ```

   Unknown-locale entries keep the raw title minus nothing; they still count (the prefix is a prefix of *most* rows, and the leaderboard tolerates a few dirty titles). Also strip the search variants (`Vous avez recherché`, `Searched`) and **drop** those records entirely - searches are not streams.

2. **videoId** from `titleUrl` via `new URL(titleUrl).searchParams.get('v')` - handles the `=` escape because JSON.parse already decoded it.

3. **Artist extraction** (music records only):
   - **a. Topic channel:** `channel?.endsWith(' - Topic')` → artist = channel minus suffix. **Poison guard:** if the result is `Release` (the real-data trap), treat as *no* artist - do not rank everything under the artist "Release".
   - **b. Title fallback:** parse `ARTIST - TRACK` / `TRACK - ARTIST` shapes from the cleaned title: strip decorations first (`(Official Video)`, `(Official Music Video)`, `[Official Audio]`, `(feat. X)` kept as feat info, `(Lyrics)`, `(HD)`, trailing `- YouTube`), then if the title matches `^(.+) [---] (.+)$`, pick the side that better matches the topic-channel name when one exists; otherwise assume `A - B` = `A` artist (dominant convention on Vevo-style uploads). Confidence `parsed`.
   - **c. Else** artist = null, confidence `unknown`. These still count toward total plays but are excluded from artist leaderboards and surfaced in Settings as "N unattributed music streams".

4. **Decoration strip** for `title` (stored cleaned): parenthetical/bracketed noise from a fixed blocklist; `feat.`/`&` variants are preserved in the string but the *grouping key* for tracks uses the pre-feat portion so "Song (feat. X)" and "Song" aggregate together.

5. **Dedupe + hash + persist.** `id = sha1(time + '::' + videoId ?? title)`. Takeout is known to duplicate rows across export parts; dedupe is by id inside the worker before persist.

### 2.5 Album strategy - the honest version

Takeout contains **no album, no track number, no ISRC**. Therefore true album grouping is impossible without external metadata (rejected). We ship:

- **"Album eras" = track-era analytics.** A track is identified by `(artistKey, cleanTrackTitle)`. The album chart renders the top 20 tracks of the selected artist/period as a stacked monthly area - "which records owned a stretch of your listening". It is labelled in the UI as *tracks*, never *albums*, to avoid inventing precision we don't have.
- Grouping heuristic only: when topic-channel is `Release - Topic`, the stripped *channel id* still identifies the release (all tracks of one album/release upload share it). We store `channelId` for grouping; enriched display data was cached in a now-removed MusicBrainz enrichment table.

### 2.6 Likes (optional playlist upload)

- User exports the "Liked music" playlist page (`youtube.com/playlist?list=LL` → Takeout → `playlists/` folder) and uploads the generated CSV/JSON alongside or later.
- Parsed into a `likes` table: `{ artistKey, trackTitle, videoId?, likedAt? }`, matched against streams by `videoId` first, fallback `(artistKey, title)` fuzzy (normalize case/punctuation).
- Artist leaderboard gets a third rank column: **likes**. Artists with likes get a tie-break boost, not a separate universe.
- Absent playlist ⇒ likes column renders as `-` everywhere; no feature gates break.

### 2.7 Missing metadata fallbacks (summary)

| Missing | Strategy |
| --- | --- |
| Artist (Release - Topic / no subtitles) | Title `A - B` parse; else null + counted as unattributed |
| Deleted video (no titleUrl) | Keep the record (ts + cleaned title); videoId null; excluded from per-video joins |
| Unknown locale prefix | Keep raw title; add locale to a detected-locales list shown in Settings |
| Duration (not in Takeout at all) | No per-track durations exist. "Estimated listening time" = plays × configurable default (default 210s, editable in Settings), clearly badged as an estimate. Rankings are plays-first, duration tie-break |

---

## 3. Analytics & Aggregation Logic

All aggregations are pure functions in `src/analytics/` over the in-memory `StreamRecord[]`. Reference SQL below documents intent and is the test oracle (Vitest fixtures assert JS output equals `sqlite3 :memory:` run of the same query on the same fixture).

**Notation:** `M` = music records, `org` = `adDriven = false`.

### 3.1 Time bucketing

```ts
type Bucket = 'day' | 'week' | 'month' | 'year';
// week = ISO week (date-fns startOfISOWeek), month = YYYY-MM-01, year = YYYY-01-01
function bucketStart(ts: number, b: Bucket): number;
function bucketKey(ts: number, b: Bucket): string; // '2026-W36' | '2026-09' | '2026'
```

### 3.2 Ranked favorite artists

```sql
SELECT artist,
       COUNT(*)                    AS plays,
       COUNT(*) * 210              AS est_seconds,
       SUM(video_id IN likes)      AS likes
FROM   streams
WHERE  kind = 'music' AND artist IS NOT NULL AND NOT ad_driven
       AND ts BETWEEN :from AND :to
GROUP  BY artist_key
ORDER  BY plays DESC, est_seconds DESC, likes DESC
LIMIT  :n;
```

JS: single pass `Map<string, Agg>` filter → group → sort. Memoize per `(from,to,includeAds)`.

### 3.3 Single-artist affinity over time

```sql
SELECT date_trunc(:bucket, ts) AS b, COUNT(*) AS plays, COUNT(DISTINCT video_id) AS unique_tracks
FROM   streams
WHERE  kind='music' AND artist_key = :artist AND ts BETWEEN :from AND :to
GROUP  BY b ORDER BY b;
```

Returned series is **gap-filled** (missing weeks get 0 - required or Recharts draws a misleading continuous line). Rendered as area (per-period plays) + overlay line (cumulative plays). Brush control at the bottom for zoom.

### 3.4 Macro taste evolution (streamgraph)

Monthly buckets × top 12 artists (by plays within the visible window) + `Other`:

```sql
WITH top AS (
  SELECT artist_key FROM streams
  WHERE kind='music' AND artist IS NOT NULL AND NOT ad_driven
  GROUP BY artist_key ORDER BY COUNT(*) DESC LIMIT 12)
SELECT date_trunc('month', ts) AS b, artist_key, COUNT(*) AS plays
FROM   streams WHERE kind='music' AND NOT ad_driven AND artist_key IN (SELECT artist_key FROM top)
GROUP  BY b, artist_key;
```

Recharts stacked `AreaChart`. Stacked area, not a true wiggle-offset streamgraph - Recharts doesn't ship one; the custom D3 offset is a stretch goal behind a flag, not a phase item. `stackOffset: 'expand'` toggle = share-of-listening view (percentage), which answers "artist dominance over time" better than absolute counts.

### 3.5 Track/album eras over time

Per `(artistKey, title)` group, month buckets, top 20 tracks of the selected scope, stacked monthly areas. Same query shape as §3.4 with `GROUP BY b, artist_key, title`.

### 3.6 Top tracks with time presets

Presets resolve to `(from, to)` epoch bounds:

| Preset | from | to |
| --- | --- | --- |
| Last week | start of ISO week, 7d window | now |
| Last month | 30d back | now |
| Last year | 365d back | now |
| `2024` / `2025` / `2026`… | Jan 1 00:00 local | Dec 31 23:59:59 local |
| Custom | date picker A 00:00 | date picker B 23:59:59 |

One aggregation service consumes `(from, to)`; presets are only range-builders. Year list is generated from the dataset's `minTs..maxTs`.

### 3.7 General YouTube view

- Top channels: `GROUP BY channel_id` (youtube kind), plays + share bar list.
- Peak viewing hours: `GROUP BY hour(ts in local tz)` → 24-bar chart; same for day-of-week (7-bar).
- Monthly viewing trend: line chart, all youtube records.
- "First watch" badges: earliest ts per channel - fun trivia layer, one pass.

### 3.8 Performance envelope

56k rows: every query above is a single O(n) pass or `Map`-grouped pass. At the 100MB ceiling (~250k rows) a full page mount is **nine-to-fourteen of those passes back to back, inside one React render** - measured at 120k rows: Music ~205ms, Video ~105ms of straight-line main-thread work. Per-query cost stayed inside the old budget; the page-level sum did not, and `useMemo` with filter-key deps cannot help with work that has to finish before the first paint.

**Superseded by Phase 9:** aggregations run in the analytics worker, not on the main thread. See §5 Phase 9 - the dataset lives in the worker (read from IndexedDB there, never structured-cloned across the boundary), pages ask for one render-ready bundle per range, and the main thread is left to paint.

---

## 4. UI/UX & Component Architecture

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ Sidebar (icon nav)  │  Content area                      │
│  ♫ Music            │  ┌──────────────────────────────┐  │
│  ▶ Video         │  │ TimeFilterToolbar (sticky)   │  │
│  ⬆ Import/Settings  │  │ [presets ▾][year ▾][custom]  │  │
│                     │  └──────────────────────────────┘  │
│                     │  …page content…                    │
└──────────────────────────────────────────────────────────┘
```

- **TimeFilterToolbar** is a shared Zustand slice - every chart on the page answers to it. Controls: preset dropdown (relative), year dropdown, custom range (two date inputs), and a "reset to full history" ghost button. Active range label always visible.
- Empty state (no data): full-page dropzone hero with a 3-step Takeout explainer.

### 4.2 Routes/pages (react-router, 3 routes)

| Route | Content |
| --- | --- |
| `/import` | Dropzone (multi-file), parse progress, dataset meta (row counts, date range, unattributed count, storage estimate), export/clear buttons, likes upload |
| `/music` | Top-artists leaderboard · Top-tracks table (respecting toolbar) · Macro taste streamgraph · Album/track eras chart |
| `/video` | Top channels · hours-of-day + day-of-week bars · monthly trend |

### 4.3 Key components

| Component | Spec |
| --- | --- |
| `ImportDropzone` | drag-drop + click; accepts `application/json`, multiple; per-file progress; error toasts per file (bad JSON, not Takeout format) |
| `ArtistLeaderboard` | shadcn Table: rank, artist, plays, est. time, likes. Row click → ArtistDrawer. Sortable columns |
| `ArtistDrawer` (profile modal) | right-side sheet: artist name, totals, affinity chart (§3.3), their top 10 tracks (click track → era mini-chart) |
| `TasteStreamgraph` | stacked area, top-12 + Other, legend with hover-isolate (hover a legend item dims all others), `absolute | expand` toggle |
| `TrackErasChart` | stacked monthly areas, top-20 tracks of current artist/period filter |
| `TopTracksTable` | rank, title, artist, plays, est. time; search box; respects TimeFilterToolbar |
| `HoursHeatBars` | 24 bars + 7 weekday bars, tooltip "x streams, y% of total" |
| `ChartCard` | shared card shell: title, subtitle, chart, download-as-PNG button (html-to-canvas, later phase) |

### 4.4 Chart interaction spec (consistent everywhere)

- Tooltip: period label, sorted series list with color chips, total row. Single-series charts show value + delta vs. previous period.
- Brush: all time-series charts ≥ 12 buckets get a Recharts `<Brush>` for zoom.
- Crosshair: vertical line snap-to-bucket.
- Palette: categorical palette from the dataviz skill reference (`references/palette.md`), dark-mode-first; `Other` always gray; max 12 hues + gray.
- All charts `ResponsiveContainer` height-locked (300-380px) to prevent layout thrash.

### 4.5 Visual design direction

Dark-first "control room" dashboard. Inter or Geist for UI, tabular numerals for metrics. One accent (music pages) vs. neutral (video) to reinforce domain separation. shadcn `sheet` for drawer, `toast` (sonner) for import feedback.

---

## 5. Phased Development Roadmap

### Phase 0 - Scaffold (½ day)

- [x] `bun create vite` (react-ts) scaffold in repo root. *(Vite 8.2 / React 19.2 / TS 6 template, moved into root)*
- [x] Tailwind CSS v4 wired via `@tailwindcss/vite` plugin. *(v4.3.3; shadcn theme tokens in `src/index.css`)*
- [x] shadcn/ui initialized (components.json, aliases, theme tokens). *(shadcn v4 registry, base-ui, Geist Variable font, `Button` + `lib/utils` scaffolded)*
- [x] Biome configured with lint + format scripts. *(v2.5.12; `lint`/`format`/`check` scripts; `public/` and `*.css` excluded - parser does not accept Tailwind v4 at-rules)*
- [x] Vite `base: '/YoutubeAnalytics/'` config. *(verified via `vite preview`: `/YoutubeAnalytics/` returns 200, assets resolve)*
- [x] react-router with the 3 placeholder routes (`/import`, `/music`, `/video`). *(react-router v8, sidebar nav + redirect routes)*
- [x] `storage.persist()` probe utility + storage estimate helper. *(`src/lib/storage.ts`: `requestPersistentStorage`, `isStoragePersisted`, `getStorageEstimate`, `formatBytes`)*
- [x] Vitest installed with a first passing test. *(vitest 5, `formatBytes` suite, 7 tests green)*
- [x] GitHub Actions Pages workflow committed (typecheck + test + build + deploy). *(`.github/workflows/deploy.yml`, bun setup, 404.html fallback, deploy-pages@v4)*
- [x] `bun run typecheck && bun run test && bun run build` all pass locally. *(2026-09-05: check 17 files clean, tsc -b clean, 7/7 tests, build 230KB js/25KB css, preview smoke 200 on base path + title + JS asset)*
- [ ] **Checkpoint:** deployed Pages URL serves the empty shell.

### Phase 1 - Ingestion pipeline (2-3 days) ← *the load-bearing phase*

- [x] Dexie schema (`streams` + `meta`) with compound indexes, replace-on-import semantics. *(`src/db/db.ts`, `[kind+ts]` + `[artistKey+ts]`; tested via fake-indexeddb)*
- [x] Ingestion Web Worker (`parse → normalize → dedupe → bulkPut` in 5k transactions) with progress events and multi-file merge. *(`src/ingestion/ingestion.worker.ts` + `ingestClient.ts`; worker asset confirmed in `dist/`)*
- [x] Title/artist extraction: locale-prefix table, `Release - Topic` guard, confidence flags. *(`prefixes.ts`, `titleParse.ts`, `normalize.ts`)*
- [x] Vitest suite against fixtures (Release-Topic, missing titleUrl, ad rows, search rows, unknown-locale). *(`src/test/fixtures/takeout-fixture.json`, 42 tests total green)*
- [x] ImportView: multi-file dropzone, progress, dataset meta panel, clear-data, storage estimate + persist probe. *(persist requested after each import; storage used/quota/eviction-protected shown)*
- [x] Real-data verification script: counts match grep ground truth (39,744 music / 16,556 youtube of 56,300), timing < 5s. *(`bun scripts/verify-ingest.ts`: 56,300 kept, split exact, 372 ms, 0 dropped/dupes, 573 unattributed)*
- [x] **Checkpoint:** import 23.5MB file < 5s; row counts match; reload keeps data; clear works; storage estimate shown. *(normalize+dedupe 372ms ≪ 5s; DB replace/clear round-trip unit-tested; true browser-reload persistence = manual check when UI is used in a real browser)*

**Phase 1 data traps found in the real file** (now handled + regression-tested): `header` is `"YouTube Music"` with a **non-breaking space** - plain `===` matched zero rows until normalized; 573 music rows have no recoverable artist (mostly `Release - Topic`); zero search rows and zero duplicate rows in this particular export.

### Phase 2 - Music MVP (2 days)

- [x] Zustand time-filter toolbar + preset/year/custom range logic. *(`src/state/filters.ts` + `TimeFilterToolbar`: all-time / 7d / 30d / 365d / year buttons / custom date pair, sticky)*
- [x] Top-artists leaderboard + top-tracks table (plays + est. time columns). *(`ArtistLeaderboard` w/ share bars + row-click drawer, `TopTracksTable`)*
- [x] Dataset store: whole table loaded into memory on start, aggregations memoized. *(`src/state/dataset.ts` zustand; all queries `useMemo` over `(records, range)`)*
- [x] **Checkpoint:** "Last month" numbers cross-checked against an independent count script on the raw JSON (test oracle, §3). *(`bun scripts/verify-analytics.ts`: top-5 artists agree positionally; full track maps identical - 514/514 (title, plays) entries - between app pipeline and an independently-coded naive counter)*

### Phase 3 - Music graphs (3 days)

- [x] Affinity chart + ArtistDrawer; macro streamgraph (+expand toggle); track-eras chart. Gap-filling + brush. *(`ArtistAffinityChart` w/ Brush, `StackedErasChart` stacked monthly areas w/ Absolute|Share toggle + hover-isolate legend, hand-rolled `ArtistDrawer` slide-over; unit tests prove contiguous spans + zero-filled gaps)*
- [x] **Checkpoint:** every chart renders with `startOfYear(minTs)…now` and any single-year slice without blank-gap artifacts; tooltips correct on gap weeks (0 shown). *(gap-filling verified at data level by `analytics.test.ts`: contiguous bucket spans, zero buckets present in series; all-zero tooltips are deliberately suppressed; visual/interaction pass lands with the Phase 5 Playwright smoke)*

Design notes from implementation:
- Cumulative overlay line on the affinity chart was dropped: two scales on one axis violates the one-axis rule; the drawer shows cumulative total as a stat instead.
- Series palette = dataviz reference palette (8 dark slots, adjacency-validated); colors bind to entities via a persistent registry so filter changes never repaint surviving series; 9th+ series folds into gray "Other".

### Phase 4 - General YouTube video (1-2 days)

- [x] Analytics: top channels (incl. first-watch), hour-of-day + weekday histograms, monthly trend, summary stats. *(`src/analytics/youtube.ts`; channels grouped by channelId, fallback display name; Monday-first weekdays; all pure O(n))*
- [x] VideoView: stat tiles, channel leaderboard, bar charts (hours, weekdays), monthly trend line. *(peak hour highlighted in accent; single-series charts need no legend per dataviz rules; shares the time-filter toolbar with Music view)*
- [x] Oracle: channel + hour counts cross-checked against an independent naive counter on the raw JSON. *(`bun scripts/verify-youtube.ts`: 7,507/7,507 channel (name, views) pairs MATCH, all 24 hour slots MATCH, 31 trend months MATCH)*
- [x] **Checkpoint:** same gate as Phase 2 (typecheck/check/test/build + oracle OK). *(61/61 tests, biome 51 files clean, build green, all 3 oracles OK, preview smoke 200 on all routes)*

Note: an earlier build ranked `(unknown channel)` (958 views) as the top channel in the real export - rows whose subtitles were stripped by Google. Those rows are still expected Takeout behavior, but they are no longer ranked as a channel; see Phase 9.

### Phase 5 - Likes, polish, hardening (2-3 days)

- [x] Likes: playlist CSV/JSON upload, tolerant parser, Dexie `likes` table, videoId-first matching with artist+title fallback, likes column on artist leaderboard. *(`src/ingestion/likesParse.ts` fuzzy-header CSV + JSON array parser (+tests), Dexie schema v2 `likes` table, `matchLikes` in `src/analytics/likes.ts` (strips ` - Topic` on the fallback key), `LikesUpload` on ImportView, likes cell on `ArtistLeaderboard` rendering "-" when absent)*
- [ ] Streaming >100MB fallback path (only if interface churn risk is acceptable - else defer). *deferred per the item's own condition: current `File.text()` path passes the 100MB budget below; no churn risk taken*
- [x] 100MB synthetic fixture perf pass. *(`bun scripts/perf-100mb.ts`: 104.8MB / 408k rows generated, normalize+dedupe 2,607 ms = 156.5k rows/s, well under the 30s budget)*
- [x] a11y pass (keyboard nav, aria-labels on charts); error boundaries. *(leaderboard rows focusable + Enter/Space open drawer, all charts wrapped `role="img"` + `aria-label`; `ErrorBoundary` wraps the route tree in `App.tsx`)*
- [x] **Checkpoint:** Playwright smoke: import fixture → navigate all pages → assert non-empty charts. *(`tests/e2e/smoke.spec.ts`, `bun run test:e2e`: 2/2 passed - import fixture, music + video pages non-empty, empty-state pointer)*

### Phase 6 - Stretch (implemented 2026-09-06, scope decided via stakeholder Q&A)

- [x] `channelId → release` display (releaseName + artist cached in Dexie `mbReleases` table, "Release - Topic" channelIds resolved via most-common-track-title search; `ReleaseLeaderboard` card on the Music page joins cache→plays at read time - streams never mutated. **User-approved exception to locked decision #0** ("no external API calls"): the only network feature)*
- [x] PNG export. *(`ChartCard` renders a download-as-PNG button per card via `html-to-image`, filename derived from the card title)*
- [x] Multi-dataset compare - scoped as **snapshot compare** (stakeholder decision). *(`SnapshotManager` on Import: save current dataset under a name, list/delete; Dexie v3 `snapshots` + `snapshotData` tables; Music page `ComparePicker` overlays a snapshot on the favorite-artists leaderboard ("vs snap" delta column with ▲/▼ arrows + %, "new" for absent artists) and a current-vs-snapshot trend line - one axis, legend chips)*
- [x] Watch-time heatmap calendar. *(`src/analytics/heatmap.ts` day-bucket aggregation + `HeatmapCalendar` GitHub-style month grid on Video; intensity = quartiles of active days, sequential blue ramp steps 600/500/350/250 validated with the dataviz ordinal checker on the dark surface; tooltip, Less/More legend, role=img summary. Now range-scoped like every other chart: it originally ignored the time filter and drew the whole dataset, so `dayCounts`/`buildCalendar` take `Range` and cells outside it carry `inRange: false` and render blank - a day the filter excludes must not read as a day without plays)*
- [x] **Checkpoint:** full local gate. *(2026-09-06: biome check 75 files clean, tsc -b clean, 85/85 unit tests, vite build green, Playwright smoke 2/2)*

**Total estimate:** ~11-14 focused days to feature-complete.

### Phase 7 - World map of artist origins (implemented 2026-09-06, requested directly by the user)

- [x] Dexie v4 `artistOrigins` table (pk `artistKey`) + `putArtistOrigins`/`allArtistOrigins`/`clearArtistOrigins`; deliberately outside `clearDataset()` - the origin cache survives "Clear data" and is reused across re-imports. *(`src/db/db.ts` version(4) full-copy block, `ArtistOrigin`/`OriginPrecision` in `src/db/types.ts`; survival covered by a dedicated `db.test.ts` case)*
- [x] Lookup libs, pure + abortable. *(`src/lib/mbArtist.ts` MusicBrainz artist search - `begin_area` = birth/foundation place, the "where they are from" signal; `area` (activity) deliberately ignored; backoff retries 5/10/15s on 429/502/503, permanent misses only on clean empty responses. `src/lib/geocode.ts` Open-Meteo geocoding with `countryCode` disambiguation + city/subdivision classification. `src/lib/iso.ts` alpha-2→numeric/name table. `src/lib/geo.ts` bundled Natural Earth 110m decode + country centroids - all local)*
- [x] Origin resolution state. *(`src/state/origins.ts`: `originTargets` = all-time attributed artists, plays-desc; `originFromLookups` decision matrix city > subdivision > country > miss with country-centroid fallback; paced 1 req/s cancelable run, batched persistence every 5, incremental cache growth so the map fills live; toggle `origin-lookup-optin` defaults ON per explicit user decision, auto-starts on map open)*
- [x] `/map` route + World Map nav. *(`src/pages/MapWorldView.tsx`: all-time by design (no time filter), live progress line, origins table ranked by plays with precision chips + MusicBrainz name-mismatch hints; `src/components/charts/WorldMap.tsx`: geoEqualEarth SVG from bundled `world-atlas` countries-110m (~55 kB gzip added), origin countries tinted, one bubble per place sized by all-time plays, hover tooltips)*
- [x] Import-page controls. *(`src/components/OriginLookupCard.tsx`: ON-by-default toggle, Run now / Cancel, progress, placed/not-found counts, Clear cache)*
- [x] View-mode switch: dots / heatmap / play-weighted heatmap. *(2026-09-06 user request. `src/components/charts/WorldMap.tsx` takes a `MapMode` prop - "dots" is the previous bubble view; "heat" weights each place by its artist count, "heat-plays" by all-time plays. Heat modes render a `feGaussianBlur`-softened SVG glow per place, colored by `rampColor` from the same Phase 6 ordinal blue ramp via `src/lib/heat.ts`; `heatIntensities` sqrt-normalizes the heavy-tailed weights so one mega-place doesn't flatten the map. Transparent hit circles keep per-place hover tooltips; segmented `fieldset` switch lives in the ChartCard header; per-mode legend ramp + aria-label. `src/lib/heat.test.ts` covers endpoints/clamping/monotone ramp + sqrt normalization; refined same day per user feedback - the glow is clipped to the land silhouette (`wm-land-clip` clipPath) so it never bleeds over ocean, and heat modes drop the origin-country tint (dots mode keeps it))*
- [x] Map zoom & pan. *(2026-09-06 user request. Wheel zooms at the cursor via a non-passive listener (React's `onWheel` is passive), drag pans with pointer capture, double-click zooms in, and +/−/reset buttons overlay the map corner. Pure math in `src/lib/mapZoom.ts` - `clampView` keeps k in [1,10] and the pan clamped so the map always covers the viewBox, `zoomAtPoint` holds the cursor point fixed; country/dot stroke widths compensated 1/k. Covered by `src/lib/mapZoom.test.ts`. Verified live: button/drag/wheel/double-click transforms, k-floor clamp, reset to identity, tooltip + heat glow correct at zoom)*
- [x] Docs amendments. *(§0 exception row now names both network features; CLAUDE.md network line updated to match)*
- [x] **Checkpoint:** full local gate + live verification. *(2026-09-06: biome check clean, tsc -b clean, 121/121 unit tests, vite build green; Playwright smoke extended to `/map` with lookups disabled for hermetic CI. Live dev-server run against the real 56,300-row export: auto-start resolved artists most-played-first (Future → Atlanta GA, Yeat → Irvine CA, A$AP Rocky → Harlem NY), 1 req/s held, MusicBrainz 503 bursts weathered by backoff and resumable from cache (3,255 artists total); React duplicate-key warning from un-id'd Natural Earth features fixed via synthetic keys)*

### Phase 8 - Content-routed, additive import (implemented 2026-10-04)

The pain that prompted it: exports taken months apart all contain a file named `watch-history.json`, so they sit in separate folders where a file picker cannot multi-select, and the only way to layer them was drag-one-then-watch-it-replace-the-previous.

- [x] **Content classification, no filename heuristics.** *(`src/ingestion/detect.ts`: `scanArrayPrefix` pulls complete leading elements out of a *prefix* of a file (string-aware brace matching, so escaped quotes and `{}`/`[]` inside titles survive), then `classifyTakeoutText` decides by shape. A history row needs `title` + (`header` or `titleUrl`) + a parseable `time`; 80% of sampled rows must match. This is what makes "is it a JSON array" safe to drop as a gate: `search-history.json` (`{query, time}`) and `subscriptions.json` (`{title}`) are arrays too and would otherwise import 0 rows silently. UTF-8 BOM, truncated prefixes, empty arrays, `null`/nested-array payloads and HTML-served-as-.json are all rejected with a specific reason)*
- [x] **Playlist routing from the same drop.** *Playlist JSON/CSV is recognized and routed to the `likes` table in the same transaction, so a whole Takeout folder goes in at once. A playlist row needs a video id, or a title *plus* an added-date - without the date requirement `subscriptions.json` would file an entire channel list as liked tracks (caught by a failing test, not by inspection)*
- [x] **Per-file verdicts, no abort-on-first-error.** *(`ingestion.worker.ts`: every file yields a `{role, reason}`; unparseable and unrecognized files are skipped and reported instead of failing the run. `fileCount` in meta counts only files actually read, so provenance never overstates)*
- [x] **Two import modes.** *(`db.ts` `commitDataset({mode})`: `add` upserts by row id (idempotent, last-writer-wins, so a fresher export corrects titles/ad flags Takeout rewrote in place) and `replace` clears first. Add mode re-derives the meta aggregates from the merged table with a cursor pass rather than delta-ing stored counters. One `rw` transaction across streams + meta + likes: all of a run lands or none of it does. The choice is persisted in `localStorage` so a user layering exports is not re-asked)*
- [x] **Preflight before write.** *(`src/components/ImportReview.tsx`: dropping stages files, shows what each one is with its reason and size, and only then offers Import. Import is disabled when nothing is usable, so a mis-drop cannot wipe a dataset. Replace additionally snapshots the current dataset first and confirms with the real row count - "replace" became undoable by reusing the Phase 6 snapshot machinery)*
- [x] **Content identity + batch-position labels for same-named files.** *Same user request again: several exports in one batch are all called `watch-history.json`. `contentSignature(size, head, tail)` = sha1 over the size plus the first and last 64 KB (length-prefixed per slice, so a byte shift across the boundary cannot collide) - deliberately not a full-file hash, since reading gigabytes per drop to learn a file is "new again" would make dropping feel broken. `FileVerdict.signature` carries it up from the worker. Then: same signature = the same bytes, so the later row is dropped with "Ignored N identical files already in this batch"; different signature = genuinely new data, so `disambiguateNames` numbers it by position in the batch (`watch-history.json`, `watch-history-2.json`, `watch-history-3.json`, first occurrence keeps its real name) and the row shows "on disk as watch-history.json". Labels are recomputed on every add/remove, so the counter follows the batch rather than freezing at drop time - dropping the second file renumbers the third back to `-2`. The staging list also moved to a ref as source of truth (`commitStaged`) because `stageFiles` now reads it from async classification callbacks and must not race a stale render snapshot; `name:size:lastModified` stays as a cheap pre-filter so the same file cannot be staged twice in one tick*
- [x] **Duplicate notice inside the preflight panel.** *Per user request: an ignored duplicate is not an error, so it renders in a `notice` slot on `ImportReview` (muted border, `role="status"`) directly under the file list it explains, instead of the page-level `role="alert"` banner below the Example-data card where it read as a failed import. `ImportView` keeps `notice` in state separate from `error`; it clears on a fresh drop, on row removal and on Cancel, because it names specific rows and stops being true once they move. Genuine failures (worker crash, no usable rows, `replace` declined) still use the alert banner*
- [x] **Accumulating staging list.** *Later the same day, per user request: the batch no longer resets on each drop. `staged` holds `{key, file, verdict|null}` and new drops append, so the real workflow (one export per drag, because every part is called `watch-history.json` and they sit in separate folders) takes N drags and one Import. Details that matter: identity is `name:size:lastModified`, not name alone, so two genuinely different exports both called `watch-history.json` coexist while a double-drop of the same file is refused with a message; rows appear instantly with a "Checking" badge and fill in as each file is read, so one slow 2 GB head does not block the next drop; verdicts are patched by key rather than index, since the list can grow mid-classification; each row has an `×` to pull it back out (and re-droppable afterwards); `busy` no longer covers staging, so the dropzone stays live during classification. File handles live in the staged entries rather than a parallel ref map, which is what let rows be removed without a stale map*
- [x] **Zero-row guard.** *An import resolving to no history rows is refused before the transaction opens, whatever the mode, and lists why each file was skipped. Verified live: a search-history-only drop leaves the 11-stream dataset untouched with Import disabled*
- [x] **Honest progress numbers.** *Per user report, the dropzone counter read one file too many for the whole write ("file 2/1"). Cause: the worker posts a 0-based `fileIndex` for the read and normalize phases, but sent `files.length` for the persist phase, and the view rendered `fileIndex + 1` unconditionally - so the longest phase (the 5k-chunk `bulkPut` loop) showed `N+1 of N`. Fixed at the contract rather than by clamping the arithmetic: `IngestProgress.fileIndex` is now `number | null`, persist sends `null` (no file is in flight, the batch is written as one transaction) plus `rows: allRecords.length`, and `src/ingestion/progressText.ts` owns the copy - a file position only when a file is genuinely being handled, and a row count otherwise ("N streams from this file" while parsing, "N streams to write" while persisting)*
- [x] Coverage. *(`detect.test.ts` 47 cases: classification incl. BOM/HTML/nested-array/escaped-quote edges, signature stability + collision resistance, and label numbering incl. multi-dot/extensionless/dotfile names; 6 `db.test.ts` cases for add-mode merge, last-writer-wins, aggregate recompute, counter accumulation and likes upsert; 6 `progressText.test.ts` cases pinning 1-based positions, the single-file batch, the null-index persist phase and an invariant that no position ever exceeds the batch size; 10 Playwright specs covering same-named numbering, identical-byte collapsing, multi-drop accumulation, row removal, mixed-folder drop, playlist routing, add-vs-replace and the pre-import snapshot. Gate: 193/193 unit, 10/10 e2e, tsc -b and vite build clean)*

### Phase 10 - Instant navigation (implemented 2026-10-05, requested directly by the user)

The report: every action should be instant, and navigation in particular - it should change automatically and show loading rather than block the thread.

What was actually wrong. Per-query costs were fine; the page-level sum was not, and it all ran inside a React render. Measured at 120k rows on the previous commit, `MusicView`'s mount memo set was ~205ms and `VideoView`'s ~105ms of straight-line main-thread work. Clicking a sidebar link therefore froze the tab for the length of a whole page mount with no feedback at all - the click registered, then nothing, then a page appeared. Two more costs sat behind it: `structuredClone` of the dataset for a worker hand-off measured ~152ms, and selecting a snapshot deserialized a second full copy of the rows onto the UI thread.

- [x] **The dataset lives in the analytics worker.** *(`src/analytics/analytics.worker.ts`.) IndexedDB is available in workers - the ingestion worker already relied on that - so the worker reads `streams`, `likes` and the active snapshot itself and the 120k-row array never crosses a boundary at all. That is strictly better than handing it over: `structuredClone` alone cost ~152ms. The worker is long-lived and reloads only when told the tables changed; the track-key memo is dropped with the reload, since it is keyed by title and the new dataset's titles are a subset*
- [x] **One request per page, not one per chart.** *(`src/analytics/dashboard.ts` + `protocol.ts`.) `musicDashboard` / `videoDashboard` / `artistDashboard` / `compare` / `likesDashboard` / `originPlays` each answer "what does this page render for this range?" in a single call, replacing the 9-14 independent `useMemo` passes per page. Requests carry data (a range, an artistKey, a leaderboard to join against) rather than callbacks, because the worker boundary is a structured clone. `likesDashboard` and `originPlays` are separate requests on purpose: likes change on their own uploads and the map is all-time, so neither should invalidate the leaderboard*
- [x] **The UI keeps its numbers while they change.** *(`src/state/useAnalytics.ts`.) First render shows a skeleton, but a *later* input - a time filter, a range change - keeps the previous answer on screen and flips `refreshing`. Blanking a dashboard to a spinner on every year click feels slower than the 200ms it replaces. A dataset change is the exception and does drop stale data, because those numbers described rows that no longer exist. Late answers for superseded requests are discarded by token, and unmounts do not leak*
- [x] **Result cache keyed by request + generation.** *(`src/analytics/analyticsClient.ts`.) Navigating Music → Video → Music answers the second Music visit from memory: no request, no skeleton, no wait. Bounded at 24 entries, since clicking through the year buttons would otherwise pin one result per range ever visited. In-flight requests are de-duplicated by key, which is what lets the hook depend on the request object without a "have I already asked" guard - such a guard is fatal under StrictMode, where the simulated unmount disarms the listener and the re-mount declines to re-ask, leaving the page on its skeleton forever (found live, not reasoned about). Every response carries the generation it was computed against, so a result built from rows the UI has already replaced can never be adopted*
- [x] **Invalidation owned by the writer.** *The dataset store bumps the generation after a reload; `LikesUpload` does it after a write. Deliberately NOT in `useLikesStore.reload`, which every Music-page mount calls to pick up an upload made elsewhere - an unconditional invalidation there would throw away the whole cache on every navigation, which is exactly what makes navigation instant*
- [x] **Visible progress.** *(`PageSkeleton` + the thin bar in `App.tsx`.) The skeleton is `role="status"`, not an alert: nothing failed, and a screen reader is told the page is working rather than left in silence. `AnalyticsProgress` covers the smaller range changes that deliberately keep the old content. Both state "updating", never "wait, error"*
- [x] **Snapshots no longer deserialize onto the UI thread.** *(`snapshots.ts`.) Selecting a compare snapshot used to load its full record array onto the main thread; the worker loads the rows itself now, so the store only records WHICH snapshot is selected and `select()` became synchronous - which also removed the `loading` state the picker used to disable itself with. `HeatmapCalendar` likewise takes a built `Calendar` instead of `records`*
- [x] **Coverage.** *(`dashboard.test.ts` 11 cases pinning each bundle against the individual query functions it replaced, so an accidental change to an aggregate fails loudly rather than drifting with it. 3 Playwright specs, two of which seed 120k rows directly into IndexedDB: no long task (>50ms) across six page navigations; the loading status is painted; and the filter change is asserted frame-by-frame to never blank the card. The two timing tests need a seeded dataset - against the 9-row fixture every aggregation finishes within a millisecond and the loading states are genuinely never painted, so asserting on them would be a race. Gate: 229/229 unit, 13/13 e2e, biome + tsc -b + vite build clean)*

Measured, same machine, 120k rows, `vite preview` build, comparing this commit against its parent (a worktree of `HEAD` at `2661a54`), long tasks observed on the main thread during navigation:

| | before | after |
| --- | --- | --- |
| Music, first visit | 792ms | 143ms |
| Video, first visit | 595ms | 83ms |
| Music, repeat visit | 830ms | 68ms |
| Longest main-thread block | 573ms | 249ms |

The remaining ~100-250ms blocks are Recharts rendering and the chart data entering the DOM - rendering cost, not aggregation - and they are now the only thing between a click and the page appearing.
### Phase 9 - Real channel attribution (implemented 2026-10-05, requested directly by the user)

The report: the Videos page ranked `(unknown channel)` and `"Des recommandations basées sur la position ont été fournies"` among the top channels. Both are Takeout artifacts, not channels.

Two distinct shapes, found by profiling two real exports (16,556 and 40,410 youtube rows):

| Shape | Rows (2022-2025 export) | What it is |
| --- | --- | --- |
| No subtitles at all | 3,794 | Deleted videos (`"Vous avez regardé une vidéo qui a été supprimée"`), ad clicks, metadata Google stripped. Previously collapsed into one `(unknown channel)` bucket that topped the leaderboard |
| A name but no channel id and no video id | 448 | Takeout *system* rows whose first subtitle is a localized platform string, not a channel: `"Des recommandations basées sur la position ont été fournies"` (429), survey answers (`"Réponse : Adobe Studio"`, 19). The extra subtitles are weather lines |

- [x] **Structural rule, not a French blocklist.** *(`src/analytics/channelAttribution.ts`: `isChannelRow` accepts a channel id, or a name plus a real video id behind it. The second clause is what separates a name-only channel (subtitle url that is not a `/channel/UC...` path) from a system row, and it never reads the channel string - so the rule is export-locale independent, unlike a list of French phrases. Verified across both exports: it matches only the 448 system rows and zero real channels; no youtube row in either file has a name + video id but no channel id, so the clause has no false positives on real data)*
- [x] **`topChannels` never invents a channel.** *Skips non-attributable rows instead of ranking them. The `(unknown channel)` synthetic bucket is gone; `channelKeyOf`/`channelNameOf` keep the id-preferred keying and the name fallback*
- [x] **The stat tile and the leaderboard stay reconcilable.** *`youtubeSummary` keeps `totalPlays` as every organic youtube row (so it still matches the trend line and both histograms, which count the same rows) but counts `uniqueChannels` over real channels only, and adds `unattributed` - the rows no channel can be credited for. `ChannelLeaderboard` renders it as a footnote ("N views in this range not ranked - Takeout recorded no channel for them") instead of leaving two numbers that should match silently disagreeing. Removing rows without accounting for them would have traded a fake channel for an unexplained gap*
- [x] **Oracle re-derived independently, not shared.** *`scripts/verify-youtube.ts` now re-derives the channel predicate from the raw JSON fields (subtitle url regex + `?v=` check) rather than importing the app helper, so it still cross-checks the rule instead of restating it. Against the 2022-2025 export: 8,889/8,889 channel (name, views) pairs MATCH, 40,410/40,410 views MATCH, all 24 hour slots MATCH, 60 trend months MATCH. Ranking went from `(unknown channel)` 958 / `Des recommandations...` 429 at the top to Linus Tech Tips 478 / Luna 413 / SQUEEZIE 396*
- [x] Coverage. *(`channelAttribution.test.ts` 8 cases: id-without-name, name-only-with-video, the two rejected shapes with real French strings, plus an explicit locale-independence case; `youtube.test.ts` gains a `FAKE` block of the three real row shapes and 4 cases - no fake name ever appears, a name-only channel still ranks, ads are still dropped on top of the attribution filter, and `summary` counts them as plays but not as channels. The `R` fixture gained a no-channel row so the histogram/trend expectations prove unattributable views are still counted as views. Smoke asserts the Videos page renders no `(unknown channel)` cell and shows the footnote. Gate: 230/230 unit, 11/11 e2e, tsc -b clean, biome clean, vite build green)*

---

## 6. Repository Layout (target)

```
src/
  analytics/        # pure aggregation fns, time bucketing, page bundles,
                    # analytics worker + protocol + main-thread client
  components/       # shadcn wrappers, ChartCard, toolbar, PageSkeleton
  db/               # dexie schema, persistence helpers
  ingestion/        # worker, normalize.ts, prefixes.ts, titleParse.ts
  pages/            # ImportView, MusicView, VideoView, MapWorldView
  state/            # zustand stores (filters, dataset, likes, snapshots)
                    # + useAnalytics (the one hook pages get numbers through)
  test/fixtures/    # sliced real-file fixtures (committed)
```

Committed fixtures contain personal data - the repo is private by intent; if it ever goes public, fixtures move to a local-only path excluded from the bundle.
