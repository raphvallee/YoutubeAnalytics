import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import {
	hourHistogram,
	hourWeekdayHistogram,
	topChannels,
	weekdayHistogram,
	youtubeSummary,
	youtubeTrend,
} from "./youtube";

// Local-noon constructors: tests must not depend on the machine timezone.
const T = (y: number, m: number, d: number, h = 12) =>
	new Date(y, m - 1, d, h).getTime();

function yt(
	partial: Partial<StreamRecord> & { id: string; ts: number },
): StreamRecord {
	return {
		kind: "youtube",
		videoId: null,
		title: "Video",
		rawTitle: "Vous avez regardé Video",
		artist: null,
		artistKey: "",
		artistConfidence: "unknown",
		channel: "Channel",
		channelId: "UC1",
		adDriven: false,
		...partial,
	};
}

const R: StreamRecord[] = [
	yt({ id: "1", ts: T(2026, 1, 5, 9), channel: "Alpha", channelId: "UCa" }),
	yt({ id: "2", ts: T(2026, 1, 6, 22), channel: "Alpha", channelId: "UCa" }),
	yt({ id: "3", ts: T(2026, 1, 10, 9), channel: "Beta", channelId: "UCb" }),
	yt({ id: "4", ts: T(2026, 2, 1, 23), channel: "Gamma", channelId: null }), // no channelId → grouped by name
	yt({
		id: "5",
		ts: T(2026, 2, 2, 12),
		channel: "Ads",
		channelId: "UCd",
		adDriven: true,
	}),
	yt({
		id: "6",
		ts: T(2026, 2, 3, 12),
		channel: "Music",
		artistKey: "m",
		kind: "music",
	}), // music kind excluded
];

const RANGE = { from: T(2026, 1, 1), to: T(2026, 3, 1) };

describe("topChannels", () => {
	it("ranks by views, groups by channelId, tracks first watch", () => {
		const list = topChannels(R, RANGE);
		expect(list.map((c) => c.channel)).toEqual(["Alpha", "Beta", "Gamma"]); // ad row excluded
		expect(list[0]?.plays).toBe(2);
		expect(list[0]?.firstWatch).toBe(T(2026, 1, 5, 9));
	});

	it("groups rows without channelId by display name", () => {
		const list = topChannels(R, RANGE);
		expect(list.find((c) => c.channel === "Gamma")?.channelId).toBeNull();
	});
});

describe("hourHistogram / weekdayHistogram", () => {
	it("counts by local hour", () => {
		const h = hourHistogram(R, RANGE);
		expect(h[9]).toBe(2); // rows 1 and 3
		expect(h[22]).toBe(1);
		expect(h[12]).toBe(0); // row 5 is ad-driven, row 6 is music
	});

	it("maps Sunday to the last slot (Monday-first)", () => {
		// 2026-01-04 is a Sunday; 2026-01-05 is a Monday.
		const r = [
			yt({ id: "sun", ts: T(2026, 1, 4) }),
			yt({ id: "mon", ts: T(2026, 1, 5) }),
		];
		const d = weekdayHistogram(r, { from: 0, to: Number.MAX_SAFE_INTEGER });
		expect(d[0]).toBe(1); // Monday
		expect(d[6]).toBe(1); // Sunday
	});
});

describe("hourWeekdayHistogram", () => {
	it("is byte-identical to hourHistogram + weekdayHistogram", () => {
		const merged = hourWeekdayHistogram(R, RANGE);
		expect(merged.hours).toEqual(hourHistogram(R, RANGE));
		expect(merged.weekdays).toEqual(weekdayHistogram(R, RANGE));
	});

	it("agrees on out-of-range, music and ad-driven rows too", () => {
		const mixed = [
			...R,
			yt({ id: "pre", ts: T(2025, 12, 31, 23) }), // before range
			yt({ id: "post", ts: T(2026, 4, 2, 7) }), // after range
			yt({ id: "on-from", ts: T(2026, 1, 1, 12) }), // inclusive edges
			yt({ id: "on-to", ts: T(2026, 3, 1, 12) }),
			yt({ id: "sat", ts: T(2026, 1, 10, 15) }),
			yt({ id: "sun", ts: T(2026, 1, 11, 3) }),
			yt({ id: "music-ads", ts: T(2026, 1, 8, 20), kind: "music" }),
		];
		const merged = hourWeekdayHistogram(mixed, RANGE);
		expect(merged.hours).toEqual(hourHistogram(mixed, RANGE));
		expect(merged.weekdays).toEqual(weekdayHistogram(mixed, RANGE));
		// 4 organic rows from R (ad + music excluded) + 4 of the 5 added in-range
		// youtube rows ("music-ads" excluded) = 8 counted.
		expect(merged.hours.reduce((a, b) => a + b, 0)).toBe(8);
	});

	it("agrees with both originals when includeAds is set", () => {
		const opts = { includeAds: true };
		const merged = hourWeekdayHistogram(R, RANGE, opts);
		expect(merged.hours).toEqual(hourHistogram(R, RANGE, opts));
		expect(merged.weekdays).toEqual(weekdayHistogram(R, RANGE, opts));
		expect(merged.hours[12]).toBe(1); // the ad row now counts, music still does not
	});

	it("keeps 24 hour slots and Monday-first weekday indexing", () => {
		const merged = hourWeekdayHistogram(R, RANGE);
		expect(merged.hours).toHaveLength(24);
		expect(merged.weekdays).toHaveLength(7);
		// R: Mon 01-05, Tue 01-06, Sat 01-10, Sun 02-01 (ad + music excluded).
		expect(merged.weekdays).toEqual([1, 1, 0, 0, 0, 1, 1]);
	});

	it("maps Sunday to the last slot, like weekdayHistogram", () => {
		// 2026-01-04 is a Sunday; 2026-01-05 is a Monday.
		const r = [
			yt({ id: "sun", ts: T(2026, 1, 4) }),
			yt({ id: "mon", ts: T(2026, 1, 5) }),
		];
		const range = { from: 0, to: Number.MAX_SAFE_INTEGER };
		const merged = hourWeekdayHistogram(r, range);
		expect(merged.weekdays[0]).toBe(1); // Monday
		expect(merged.weekdays[6]).toBe(1); // Sunday
		expect(merged.weekdays).toEqual(weekdayHistogram(r, range));
	});

	it("returns empty histograms without records", () => {
		const merged = hourWeekdayHistogram([], RANGE);
		expect(merged.hours).toEqual(new Array<number>(24).fill(0));
		expect(merged.weekdays).toEqual(new Array<number>(7).fill(0));
	});
});

describe("youtubeTrend / youtubeSummary", () => {
	it("gap-fills months", () => {
		const trend = youtubeTrend(R, RANGE, "month");
		expect(trend.map((p) => p.plays)).toEqual([3, 1, 0]); // Jan, Feb, Mar
	});

	it("summarizes youtube kind only", () => {
		const s = youtubeSummary(R, { from: 0, to: Number.MAX_SAFE_INTEGER });
		expect(s.totalPlays).toBe(4); // ad row excluded, music row excluded
		expect(s.uniqueChannels).toBe(3);
	});
});
