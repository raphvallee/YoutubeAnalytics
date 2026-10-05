/**
 * General YouTube analytics (non-music) - BLUEPRINT §3.7.
 * Same contract as queries.ts: pure O(n) passes over StreamRecord[].
 */

import type { StreamRecord } from "@/db/types";
import { type Bucket, bucketKey, buildBucketSpans } from "./buckets";
import {
	channelKeyOf,
	channelNameOf,
	isChannelRow,
} from "./channelAttribution";
import { inRange, type QueryOptions, type Range } from "./queries";

export interface ChannelAgg {
	channel: string;
	channelId: string | null;
	plays: number;
	/** Earliest play in range - "first watch" trivia layer. */
	firstWatch: number | null;
}

/**
 * Top channels, grouped by channelId when present, else by display name.
 * Includes ad-driven rows? No - organic default matches music queries.
 *
 * Rows that cannot be credited to a real channel are skipped rather than
 * ranked: no subtitles at all (previously the `(unknown channel)` bucket) and
 * Takeout system rows whose first subtitle is a platform string, not a
 * channel. See `channelAttribution.ts`. `youtubeSummary().unattributed`
 * reports how many rows that is, so the leaderboard never has to invent a
 * channel name to hold them.
 */
export function topChannels(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
	limit = 20,
): ChannelAgg[] {
	const counts = new Map<string, ChannelAgg>();
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		if (!isChannelRow(r)) continue;
		const key = channelKeyOf(r);
		let agg = counts.get(key);
		if (!agg) {
			agg = {
				channel: channelNameOf(r),
				channelId: r.channelId,
				plays: 0,
				firstWatch: null,
			};
			counts.set(key, agg);
		}
		agg.plays += 1;
		if (agg.firstWatch === null || r.ts < agg.firstWatch) agg.firstWatch = r.ts;
	}
	return [...counts.values()]
		.sort((a, b) => b.plays - a.plays || a.channel.localeCompare(b.channel))
		.slice(0, limit);
}

/** 24-slot play histogram by local hour of day. */
export function hourHistogram(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): number[] {
	const hours = new Array<number>(24).fill(0);
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		const h = new Date(r.ts).getHours();
		hours[h] = (hours[h] ?? 0) + 1;
	}
	return hours;
}

/** 7-slot play histogram, Monday-first, by local weekday. */
export function weekdayHistogram(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): number[] {
	// getDay(): 0=Sunday..6=Saturday; map to Monday-first index.
	const shift = (d: number) => (d + 6) % 7;
	const days = new Array<number>(7).fill(0);
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		const i = shift(new Date(r.ts).getDay());
		days[i] = (days[i] ?? 0) + 1;
	}
	return days;
}

/**
 * Both histograms from a single pass over `records`, one `Date` per row.
 * Byte-identical to calling `hourHistogram` + `weekdayHistogram` separately:
 * same `youtube`-kind and range/ad predicate, same index conventions
 * (0-23 local hour, Monday-first weekdays). Cheaper because the predicate
 * runs once per row instead of twice and the `Date` is built once.
 */
export function hourWeekdayHistogram(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): { hours: number[]; weekdays: number[] } {
	const hours = new Array<number>(24).fill(0);
	const weekdays = new Array<number>(7).fill(0);
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		const d = new Date(r.ts);
		const h = d.getHours();
		hours[h] = (hours[h] ?? 0) + 1;
		// getDay(): 0=Sunday..6=Saturday; map to Monday-first index.
		const i = (d.getDay() + 6) % 7;
		weekdays[i] = (weekdays[i] ?? 0) + 1;
	}
	return { hours, weekdays };
}

export interface TrendPoint {
	key: string;
	plays: number;
}

/** Monthly (or yearly) viewing trend - youtube kind only. */
export function youtubeTrend(
	records: StreamRecord[],
	range: Range,
	bucket: Bucket,
	opts: QueryOptions = {},
): TrendPoint[] {
	const spans = buildBucketSpans(range.from, range.to, bucket);
	const spanKeys = new Set(spans.map((s) => s.key));
	const counts = new Map<string, number>();
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		const key = bucketKey(r.ts, bucket);
		if (spanKeys.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return spans.map((s) => ({ key: s.key, plays: counts.get(s.key) ?? 0 }));
}

export interface YoutubeSummary {
	/**
	 * Organic youtube rows in range - the same population the trend line and
	 * the hour/weekday histograms count, so the stat tile keeps matching them.
	 */
	totalPlays: number;
	/** Distinct real channels in range. Excludes unattributable rows. */
	uniqueChannels: number;
	/**
	 * Rows in `totalPlays` that no real channel can be credited for (missing
	 * subtitles, Takeout system rows). Surfaced so the channel leaderboard can
	 * state that it ranks fewer rows than the stat tile, instead of leaving the
	 * user to reconcile two numbers that should match.
	 */
	unattributed: number;
}

export function youtubeSummary(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): YoutubeSummary {
	let totalPlays = 0;
	let unattributed = 0;
	const channels = new Set<string>();
	for (const r of records) {
		if (r.kind !== "youtube" || !inRange(r, range, opts)) continue;
		totalPlays += 1;
		if (!isChannelRow(r)) {
			unattributed += 1;
			continue;
		}
		channels.add(channelKeyOf(r));
	}
	return {
		totalPlays,
		uniqueChannels: channels.size,
		unattributed,
	};
}
