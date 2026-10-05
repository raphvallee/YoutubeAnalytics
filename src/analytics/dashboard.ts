/**
 * Page-level aggregation bundles - docs/BLUEPRINT.md §3, Phase 9.
 *
 * Every function here answers one question: "what does this page render for
 * this range?". Each is a single shot over the in-memory dataset, so a page
 * costs ONE request instead of the nine-to-fourteen independent `useMemo`
 * passes it used to run - and, more importantly, the work happens in the
 * analytics worker (see `./analytics.worker.ts`) instead of on the thread that
 * has to paint the navigation.
 *
 * Pure: no React, no DB, no clock. That is what lets the same code run in the
 * worker, in `bun scripts/verify-*.ts`, and in unit tests.
 */

import type { LikedTrack, StreamRecord } from "@/db/types";
import type { Bucket } from "./buckets";
import { type ArtistDelta, compareArtists } from "./compare";
import { buildCalendar, type Calendar } from "./heatmap";
import { type LikesMatch, matchLikes } from "./likes";
import {
	type ArtistAgg,
	artistPlayTotals,
	availableYears,
	type MusicSummary,
	macroSeries,
	musicSummary,
	type Range,
	type SeriesPoint,
	type StackRow,
	scopedSeries,
	type TrackAgg,
	topArtists,
	topTracks,
	trackErasSeries,
} from "./queries";
import {
	type ChannelAgg,
	hourWeekdayHistogram,
	type TrendPoint,
	topChannels,
	type YoutubeSummary,
	youtubeSummary,
	youtubeTrend,
} from "./youtube";

/** Ranked rows in the "Top tracks" table; also the ranking depth below. */
export const TRACK_TABLE_LIMIT = 25;
/**
 * Series count in the stacked era charts. Must match the categorical palette
 * length (SERIES_COLORS), which is what the "9th+ folds into Other" rule counts.
 */
export const ERAS_SERIES = 8;
/** Ranked artists in the leaderboard. */
const ARTIST_LIMIT = 25;
/** Ranked channels on the video page. */
const CHANNEL_LIMIT = 25;

export interface StackSeries {
	rows: StackRow[];
	seriesNames: string[];
	bucket: Bucket;
}

/** Everything the Music page renders for one range, in one pass set. */
export interface MusicDashboard {
	years: number[];
	summary: MusicSummary;
	artists: ArtistAgg[];
	tracks: TrackAgg[];
	macro: StackSeries;
	eras: StackSeries;
}

/**
 * The Music page's mount memo set, collapsed into one call.
 *
 * `trackErasSeries` gets the leaderboard's own ranking (sliced to the series
 * count) instead of recomputing it: `topTracks` sorts before it slices, so
 * `topTracks(limit: 25).slice(0, 8)` is exactly `topTracks(limit: 8)`. That is
 * what removes a second full-dataset pass over the track-key memo.
 */
export function musicDashboard(
	records: StreamRecord[],
	range: Range,
): MusicDashboard {
	const tracks = topTracks(records, range, {}, { limit: TRACK_TABLE_LIMIT });
	return {
		years: availableYears(records),
		summary: musicSummary(records, range),
		artists: topArtists(records, range, {}, ARTIST_LIMIT),
		tracks,
		macro: macroSeries(records, range, { bucket: "month", topN: ERAS_SERIES }),
		eras: trackErasSeries(records, range, {
			bucket: "month",
			topN: ERAS_SERIES,
			tracks: tracks.slice(0, ERAS_SERIES),
		}),
	};
}

/** The artist drawer: play frequency plus their own tracks and eras. */
export interface ArtistDashboard {
	affinity: SeriesPoint[];
	affinityTotal: number;
	tracks: TrackAgg[];
	eras: StackSeries;
}

export function artistDashboard(
	records: StreamRecord[],
	range: Range,
	artistKey: string,
	bucket: Bucket,
): ArtistDashboard {
	const affinity = scopedSeries(
		records,
		range,
		bucket,
		{},
		{ kind: "music", artistKey },
	);
	return {
		affinity,
		affinityTotal: affinity.reduce((sum, point) => sum + point.plays, 0),
		tracks: topTracks(records, range, {}, { artistKey, limit: 10 }),
		eras: trackErasSeries(records, range, {
			bucket: "month",
			topN: ERAS_SERIES,
			artistKey,
		}),
	};
}

/** Everything the Video page renders for one range. */
export interface VideoDashboard {
	years: number[];
	summary: YoutubeSummary;
	channels: ChannelAgg[];
	/** 24-slot local-hour histogram. */
	hours: number[];
	/** 7-slot Monday-first weekday histogram. */
	weekdays: number[];
	trend: TrendPoint[];
	calendar: Calendar;
}

export function videoDashboard(
	records: StreamRecord[],
	range: Range,
	bucket: Bucket,
): VideoDashboard {
	const histograms = hourWeekdayHistogram(records, range);
	return {
		years: availableYears(records),
		summary: youtubeSummary(records, range),
		channels: topChannels(records, range, {}, CHANNEL_LIMIT),
		hours: histograms.hours,
		weekdays: histograms.weekdays,
		trend: youtubeTrend(records, range, bucket),
		calendar: buildCalendar(records, range),
	};
}

/**
 * Snapshot compare (Phase 6): the current trend next to the snapshot's, plus
 * per-artist deltas against the current leaderboard.
 *
 * `snapshot` is null when compare is off or no snapshot is selected - the
 * bundle then carries just the current trend and no delta column, so the page
 * does not have to re-derive "compare is on" from a record count.
 */
export interface CompareBundle {
	currentTrend: SeriesPoint[];
	snapshotTrend: SeriesPoint[] | null;
	deltas: Map<string, ArtistDelta> | null;
}

export function compareBundle(
	records: StreamRecord[],
	snapshot: StreamRecord[] | null,
	range: Range,
	bucket: Bucket,
	artists: ArtistAgg[],
): CompareBundle {
	if (!snapshot) {
		return { currentTrend: [], snapshotTrend: null, deltas: null };
	}
	const scope = { kind: "music" } as const;
	return {
		currentTrend: scopedSeries(records, range, bucket, {}, scope),
		snapshotTrend: scopedSeries(snapshot, range, bucket, {}, scope),
		deltas: compareArtists(artists, snapshot, range),
	};
}

/**
 * Likes matched to artists. Kept apart from {@link musicDashboard} because
 * likes change on their own (an upload) while the dashboard depends only on
 * the range - so an upload never invalidates the leaderboard cache.
 */
export function likesDashboard(
	records: StreamRecord[],
	likes: LikedTrack[],
): LikesMatch {
	return matchLikes(likes, records);
}

/**
 * Lifetime plays per artist, for the World Map's bubble sizes and its ranked
 * origins table. The map is all-time by design, so this takes no range.
 */
export function originPlays(
	records: StreamRecord[],
): Map<string, { artist: string; plays: number }> {
	return artistPlayTotals(records);
}
