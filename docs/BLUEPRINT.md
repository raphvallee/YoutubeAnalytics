# YouTube / YouTube Music Analytics - Technical Blueprint

Version: 1.0 · 2026-09-05
Status: Approved plan (all decisions locked via stakeholder Q&A)

---

## 0. Locked Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Framework | **Vite + React 19 + TypeScript (strict)** | Static SPA for GitHub Pages; no SSR value for a local-analytics tool |
| Package manager | **Bun** | Required |
| Query/storage engine | **IndexedDB via Dexie + `navigator.storage.persist()`** | Real dataset is 23.5MB / 56,300 rows (ceiling 100MB). DuckDB-Wasm (~2–4MB WASM) is dead weight; plain JS aggregation over in-memory arrays is single-digit milliseconds. See §1.3 persistence semantics |
| Charting | **Recharts** | Line/area/stacked-area + brush natively; React-idiomatic |
| UI kit | **shadcn/ui + Tailwind CSS v4** | Dark-mode-first dashboards, copy-paste component ownership |
| Hosting | **GitHub Pages via GitHub Actions** | Static build, `base: '/<repo>/'` |
| Likes data | **Optional playlist file upload** | `watch-history.json` contains zero like data (verified). "Liked music" lives in playlist export - user uploads it separately |
| Album analytics | **Title-parsing + local grouping only** | No album metadata exists anywhere in Takeout; external enrichment rejected for privacy. See §2.5 for the honest degradation of "album" |
| External API calls | **None, ever** | 100% local-first; the app makes no network requests after load |

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
│  ├─ OverviewView      (general YouTube analytics)          │
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

1. **≤ 100MB (our ceiling, 23.5MB today): `File.text()` + `JSON.parse` inside the Worker.** 100MB file → ~2–4s parse, transient memory ~4–6× file size (still < 1GB worst case). Progress is reported per-phase (read → parse → normalize → persist), not per-row. This is the implemented path.
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

Re-import policy: importing replaces the whole dataset (`db.transaction('rw', …, clear + bulkPut)`) - simplest correct semantics for a replaceable snapshot. Incremental merge is a Settings checkbox in a later phase.

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
   - **b. Title fallback:** parse `ARTIST - TRACK` / `TRACK - ARTIST` shapes from the cleaned title: strip decorations first (`(Official Video)`, `(Official Music Video)`, `[Official Audio]`, `(feat. X)` kept as feat info, `(Lyrics)`, `(HD)`, trailing `- YouTube`), then if the title matches `^(.+) [-–-] (.+)$`, pick the side that better matches the topic-channel name when one exists; otherwise assume `A - B` = `A` artist (dominant convention on Vevo-style uploads). Confidence `parsed`.
   - **c. Else** artist = null, confidence `unknown`. These still count toward total plays but are excluded from artist leaderboards and surfaced in Settings as "N unattributed music streams".

4. **Decoration strip** for `title` (stored cleaned): parenthetical/bracketed noise from a fixed blocklist; `feat.`/`&` variants are preserved in the string but the *grouping key* for tracks uses the pre-feat portion so "Song (feat. X)" and "Song" aggregate together.

5. **Dedupe + hash + persist.** `id = sha1(time + '::' + videoId ?? title)`. Takeout is known to duplicate rows across export parts; dedupe is by id inside the worker before persist.

### 2.5 Album strategy - the honest version

Takeout contains **no album, no track number, no ISRC**. Therefore true album grouping is impossible without external metadata (rejected). We ship:

- **"Album eras" = track-era analytics.** A track is identified by `(artistKey, cleanTrackTitle)`. The album chart renders the top 20 tracks of the selected artist/period as a stacked monthly area - "which records owned a stretch of your listening". It is labelled in the UI as *tracks*, never *albums*, to avoid inventing precision we don't have.
- Grouping heuristic only: when topic-channel is `Release - Topic`, the stripped *channel id* still identifies the release (all tracks of one album/release upload share it). We store `channelId` precisely so a future optional MusicBrainz enrichment can join `channelId → release` without re-import. Schema is ready; feature is not built.

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

56k rows: every query above is a single O(n) pass or `Map`-grouped pass - < 5ms. At the 100MB ceiling (~250k rows): still < 30ms per interaction, `useMemo` with filter-key deps prevents recomputation on unrelated re-renders. No web worker needed for queries; only ingestion.

---

## 4. UI/UX & Component Architecture

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│ Sidebar (icon nav)  │  Content area                      │
│  ♫ Music            │  ┌──────────────────────────────┐  │
│  ▶ Overview         │  │ TimeFilterToolbar (sticky)   │  │
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
| `/overview` | Top channels · hours-of-day + day-of-week bars · monthly trend |

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
- All charts `ResponsiveContainer` height-locked (300–380px) to prevent layout thrash.

### 4.5 Visual design direction

Dark-first "control room" dashboard. Inter or Geist for UI, tabular numerals for metrics. One accent (music pages) vs. neutral (overview) to reinforce domain separation. shadcn `sheet` for drawer, `toast` (sonner) for import feedback.

---

## 5. Phased Development Roadmap

### Phase 0 - Scaffold (½ day)

- [x] `bun create vite` (react-ts) scaffold in repo root. *(Vite 8.2 / React 19.2 / TS 6 template, moved into root)*
- [x] Tailwind CSS v4 wired via `@tailwindcss/vite` plugin. *(v4.3.3; shadcn theme tokens in `src/index.css`)*
- [x] shadcn/ui initialized (components.json, aliases, theme tokens). *(shadcn v4 registry, base-ui, Geist Variable font, `Button` + `lib/utils` scaffolded)*
- [x] Biome configured with lint + format scripts. *(v2.5.12; `lint`/`format`/`check` scripts; `public/` and `*.css` excluded - parser does not accept Tailwind v4 at-rules)*
- [x] Vite `base: '/YoutubeAnalytics/'` config. *(verified via `vite preview`: `/YoutubeAnalytics/` returns 200, assets resolve)*
- [x] react-router with the 3 placeholder routes (`/import`, `/music`, `/overview`). *(react-router v8, sidebar nav + redirect routes)*
- [x] `storage.persist()` probe utility + storage estimate helper. *(`src/lib/storage.ts`: `requestPersistentStorage`, `isStoragePersisted`, `getStorageEstimate`, `formatBytes`)*
- [x] Vitest installed with a first passing test. *(vitest 5, `formatBytes` suite, 7 tests green)*
- [x] GitHub Actions Pages workflow committed (typecheck + test + build + deploy). *(`.github/workflows/deploy.yml`, bun setup, 404.html fallback, deploy-pages@v4)*
- [x] `bun run typecheck && bun run test && bun run build` all pass locally. *(2026-09-05: check 17 files clean, tsc -b clean, 7/7 tests, build 230KB js/25KB css, preview smoke 200 on base path + title + JS asset)*
- [ ] **Checkpoint:** deployed Pages URL serves the empty shell. *(needs GitHub remote + first push; workflow ready)*

### Phase 1 - Ingestion pipeline (2–3 days) ← *the load-bearing phase*

- Dexie schema + worker (`parse → normalize → dedupe → bulkPut`), progress events, multi-file merge.
- Title/artist extraction with the locale-prefix table, `Release - Topic` guard, confidence flags.
- Vitest suite against **sliced fixtures from the real file** (grep-selected tricky rows: Release-Topic, missing titleUrl, ad rows, search rows).
- **Checkpoint:** import 23.5MB file < 5s; row counts match grep counts (39,744 music / 16,556 youtube); reload keeps data; clear works; Settings shows storage estimate.

### Phase 2 - Music MVP (2 days)

- Zustand time-filter toolbar + preset/year/custom range logic.
- Top-artists leaderboard + top-tracks table (plays + est. time columns).
- **Checkpoint:** numbers for "Last month" cross-checked against a manual count script run on the JSON in Node (test oracle, §3).

### Phase 3 - Music graphs (3 days)

- Affinity chart + ArtistDrawer; macro streamgraph (+expand toggle); track-eras chart. Gap-filling + brush.
- **Checkpoint:** every chart renders with `startOfYear(minTs)…now` and any single-year slice without blank-gap artifacts; tooltips correct on gap weeks (0 shown).

### Phase 4 - General YouTube overview (1–2 days)

- Channel leaderboard, hour/weekday bars, monthly trend.
- **Checkpoint:** same oracle method as Phase 2.

### Phase 5 - Likes, polish, hardening (2–3 days)

- Playlist upload + matching + likes column.
- Streaming >100MB fallback path (only if interface churn risk is acceptable - else defer).
- 100MB synthetic fixture perf pass; a11y pass (keyboard nav, aria-labels on charts); error boundaries.
- **Checkpoint:** Playwright smoke: import fixture → navigate all pages → assert non-empty charts.

### Phase 6 - Stretch (unscheduled)

- `channelId → release` MusicBrainz opt-in enrichment (schema ready, §2.5); PNG export; multi-dataset compare; watch-time heatmap calendar.

**Total estimate:** ~11–14 focused days to feature-complete.

---

## 6. Repository Layout (target)

```
src/
  analytics/        # pure aggregation fns + time bucketing
  components/       # shadcn wrappers, ChartCard, toolbar
  db/               # dexie schema, persistence helpers
  ingestion/        # worker, normalize.ts, prefixes.ts, titleParse.ts
  pages/            # ImportView, MusicView, OverviewView
  state/            # zustand stores (filters, dataset meta)
  test/fixtures/    # sliced real-file fixtures (committed)
```

Committed fixtures contain personal data - the repo is private by intent; if it ever goes public, fixtures move to a local-only path excluded from the bundle.
