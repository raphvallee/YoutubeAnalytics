/**
 * Pure aggregation functions over StreamRecord[] - docs/BLUEPRINT.md §3.
 * No React, no DB: O(n) passes, memoized by callers via useMemo.
 */

import type { StreamRecord } from "@/db/types";
import { trackKeyOfMemo } from "@/ingestion/titleParse";
import {
	type Bucket,
	type BucketSpan,
	bucketKey,
	buildBucketSpans,
} from "./buckets";

/** No per-track durations exist in Takeout - fixed estimate, BLUEPRINT §2.7. */
export const EST_SECONDS_PER_PLAY = 210;

export interface Range {
	from: number;
	to: number;
}

export interface QueryOptions {
	/** Include ad-driven rows (default: excluded from organic analytics). */
	includeAds?: boolean;
}

export function inRange(
	r: StreamRecord,
	range: Range,
	opts: QueryOptions = {},
): boolean {
	if (r.ts < range.from || r.ts > range.to) return false;
	if (!opts.includeAds && r.adDriven) return false;
	return true;
}

export function filterRange(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): StreamRecord[] {
	return records.filter((r) => inRange(r, range, opts));
}

export function estSeconds(plays: number): number {
	return plays * EST_SECONDS_PER_PLAY;
}

export interface ArtistAgg {
	artist: string;
	artistKey: string;
	plays: number;
}

/**
 * Ranked favorite artists (music only, organic). Unattributed rows
 * (artistKey === '') are excluded - BLUEPRINT §3.2.
 */
export function topArtists(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
	limit = 20,
): ArtistAgg[] {
	const counts = new Map<string, ArtistAgg>();
	for (const r of records) {
		if (r.kind !== "music" || !r.artistKey || !inRange(r, range, opts))
			continue;
		let agg = counts.get(r.artistKey);
		if (!agg) {
			agg = {
				artist: r.artist ?? r.artistKey,
				artistKey: r.artistKey,
				plays: 0,
			};
			counts.set(r.artistKey, agg);
		}
		agg.plays += 1;
	}
	return [...counts.values()]
		.sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist))
		.slice(0, limit);
}

export interface TrackAgg {
	/** Display title. */
	title: string;
	/** Grouping key: cleaned title minus decorations/feat, lowercased. */
	trackKey: string;
	artist: string | null;
	artistKey: string;
	plays: number;
}

/**
 * Top tracks. `artistKey` param scopes to one artist (null = all music).
 * Grouping key is (artistKey, pre-feat track key) - BLUEPRINT §3.5.
 */
export function topTracks(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
	{ artistKey, limit = 20 }: { artistKey?: string | null; limit?: number } = {},
): TrackAgg[] {
	const counts = new Map<string, TrackAgg>();
	for (const r of records) {
		if (r.kind !== "music" || !inRange(r, range, opts)) continue;
		if (artistKey !== undefined && r.artistKey !== artistKey) continue;
		// One key evaluation per row: this doubles as the aggregate's
		// `trackKey` field, so do not recompute it in the `if (!agg)` branch.
		const trackKey = trackKeyOfMemo(r.title);
		const key = `${r.artistKey}|${trackKey}`;
		let agg = counts.get(key);
		if (!agg) {
			agg = {
				title: r.title,
				trackKey,
				artist: r.artist,
				artistKey: r.artistKey,
				plays: 0,
			};
			counts.set(key, agg);
		}
		agg.plays += 1;
	}
	return [...counts.values()]
		.sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title))
		.slice(0, limit);
}

/**
 * Lifetime (all-time, organic) plays per artistKey over attributed music rows.
 *
 * The one pass behind `topArtists` and behind the World Map's play weighting,
 * kept separate because both need the FULL ranking rather than a truncated one:
 * a leaderboard only shows the top 25, while the map must weigh every artist
 * that has a resolved origin.
 */
export function artistPlayTotals(
	records: StreamRecord[],
): Map<string, { artist: string; plays: number }> {
	const totals = new Map<string, { artist: string; plays: number }>();
	for (const r of records) {
		if (r.kind !== "music" || !r.artistKey || r.adDriven) continue;
		let entry = totals.get(r.artistKey);
		if (!entry) {
			entry = { artist: r.artist ?? r.artistKey, plays: 0 };
			totals.set(r.artistKey, entry);
		}
		entry.plays += 1;
	}
	return totals;
}

export interface SeriesPoint {
	key: string;
	start: number;
	end: number;
	plays: number;
}

/** Single-artist (or scoped) time series, gap-filled with zero weeks - §3.3. */
export function scopedSeries(
	records: StreamRecord[],
	range: Range,
	bucket: Bucket,
	opts: QueryOptions = {},
	{ kind, artistKey }: { kind?: "music"; artistKey?: string } = {},
): SeriesPoint[] {
	const spans: BucketSpan[] = buildBucketSpans(range.from, range.to, bucket);
	const byKey = new Map(spans.map((s) => [s.key, s]));
	const plays = new Map<string, number>();
	for (const r of records) {
		if (kind && r.kind !== kind) continue;
		if (artistKey !== undefined && r.artistKey !== artistKey) continue;
		if (!inRange(r, range, opts)) continue;
		const key = bucketKey(r.ts, bucket);
		if (byKey.has(key)) plays.set(key, (plays.get(key) ?? 0) + 1);
	}
	return spans.map((s) => ({
		key: s.key,
		start: s.start,
		end: s.end,
		plays: plays.get(s.key) ?? 0,
	}));
}

export interface StackRow {
	key: string;
	/** Series name -> play count within this bucket. */
	[key: string]: number | string;
}

/**
 * Macro taste evolution (§3.4): monthly buckets x top-N artists + Other.
 * Returns rows ready for a Recharts stacked area (one column per series).
 */
export function macroSeries(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions & { bucket?: Bucket; topN?: number } = {},
): { rows: StackRow[]; seriesNames: string[]; bucket: Bucket } {
	const bucket = opts.bucket ?? "month";
	const topN = opts.topN ?? 8;
	const filtered = records.filter(
		(r) => r.kind === "music" && r.artistKey && inRange(r, range, opts),
	);

	const totals = new Map<string, { name: string; plays: number }>();
	const perBucket = new Map<string, Map<string, number>>();
	const spans = buildBucketSpans(range.from, range.to, bucket);
	const spanKeys = new Set(spans.map((s) => s.key));

	for (const r of filtered) {
		const bKey = bucketKey(r.ts, bucket);
		if (!spanKeys.has(bKey)) continue;
		let t = totals.get(r.artistKey);
		if (!t) {
			t = { name: r.artist ?? r.artistKey, plays: 0 };
			totals.set(r.artistKey, t);
		}
		t.plays += 1;
		let row = perBucket.get(bKey);
		if (!row) {
			row = new Map();
			perBucket.set(bKey, row);
		}
		row.set(r.artistKey, (row.get(r.artistKey) ?? 0) + 1);
	}

	const top = [...totals.entries()]
		.sort((a, b) => b[1].plays - a[1].plays)
		.slice(0, topN);
	const topKeys = new Set(top.map(([k]) => k));
	const seriesNames = [...top.map(([, v]) => v.name), "Other"];

	const rows: StackRow[] = spans.map((s) => {
		const row: StackRow = { key: s.key };
		for (const name of seriesNames) row[name] = 0;
		const bucketRow = perBucket.get(s.key);
		if (bucketRow) {
			for (const [artistKey, plays] of bucketRow) {
				const entry = totals.get(artistKey);
				const name = entry && topKeys.has(artistKey) ? entry.name : "Other";
				row[name] = (row[name] as number) + plays;
			}
		}
		return row;
	});

	return { rows, seriesNames, bucket };
}

/**
 * Track/album eras (§3.5): stacked buckets over the top-N tracks of scope
 * (whole music library, or one artist when artistKey given).
 */
export function trackErasSeries(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions & {
		bucket?: Bucket;
		topN?: number;
		artistKey?: string | null;
		/**
		 * Pre-computed top-N tracks, already truncated to `topN`. MusicView
		 * needs `topTracks` for the leaderboard anyway, so passing it here
		 * removes a second identical full-dataset pass. Equivalent to letting
		 * this function compute it: `topTracks` sorts before it slices, so
		 * `topTracks(limit: 25).slice(0, 8)` equals `topTracks(limit: 8)`.
		 */
		tracks?: TrackAgg[];
	} = {},
): { rows: StackRow[]; seriesNames: string[]; bucket: Bucket } {
	const bucket = opts.bucket ?? "month";
	const topN = opts.topN ?? 20;
	const tracks =
		opts.tracks ??
		topTracks(records, range, opts, {
			artistKey: opts.artistKey,
			limit: topN,
		});
	// Identity -> display title, built once. Doubles as the top-N membership set.
	// The row loop below used to call `tracks.find` with a track key evaluation
	// inside the predicate, which re-ran four regexes per (bucket x series)
	// comparison.
	const titleByIdentity = new Map<string, string>();
	for (const t of tracks) {
		const identity = `${t.artistKey}|${trackKeyOfMemo(t.title)}`;
		if (!titleByIdentity.has(identity)) titleByIdentity.set(identity, t.title);
	}
	const seriesNames = tracks.map((t) => t.title);

	const spans = buildBucketSpans(range.from, range.to, bucket);
	const spanKeys = new Set(spans.map((s) => s.key));
	const perBucket = new Map<string, Map<string, number>>();

	for (const r of records) {
		if (r.kind !== "music" || !inRange(r, range, opts)) continue;
		if (opts.artistKey !== undefined && r.artistKey !== opts.artistKey)
			continue;
		const identity = `${r.artistKey}|${trackKeyOfMemo(r.title)}`;
		if (!titleByIdentity.has(identity)) continue;
		const bKey = bucketKey(r.ts, bucket);
		if (!spanKeys.has(bKey)) continue;
		let row = perBucket.get(bKey);
		if (!row) {
			row = new Map();
			perBucket.set(bKey, row);
		}
		row.set(identity, (row.get(identity) ?? 0) + 1);
	}

	const rows: StackRow[] = spans.map((s) => {
		const row: StackRow = { key: s.key };
		for (const name of seriesNames) row[name] = 0;
		const bucketRow = perBucket.get(s.key);
		if (bucketRow) {
			for (const [identity, plays] of bucketRow) {
				const name = titleByIdentity.get(identity) ?? identity;
				row[name] = (row[name] as number) + plays;
			}
		}
		return row;
	});

	return { rows, seriesNames, bucket };
}

/** Distinct years present in the data, ascending. */
export function availableYears(records: StreamRecord[]): number[] {
	const years = new Set<number>();
	for (const r of records) years.add(new Date(r.ts).getFullYear());
	return [...years].sort((a, b) => a - b);
}

export interface MusicSummary {
	totalPlays: number;
	uniqueArtists: number;
	uniqueTracks: number;
	unattributed: number;
}

/** Headline stats for the music dashboard header. */
export function musicSummary(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): MusicSummary {
	let totalPlays = 0;
	const artists = new Set<string>();
	const tracks = new Set<string>();
	let unattributed = 0;
	for (const r of records) {
		if (r.kind !== "music" || !inRange(r, range, opts)) continue;
		totalPlays += 1;
		if (r.artistKey) artists.add(r.artistKey);
		else unattributed += 1;
		tracks.add(`${r.artistKey}|${trackKeyOfMemo(r.title)}`);
	}
	return {
		totalPlays,
		uniqueArtists: artists.size,
		uniqueTracks: tracks.size,
		unattributed,
	};
}
