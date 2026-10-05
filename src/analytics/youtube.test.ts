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
	// A real video that has no videoId either: no channel can be named.
	yt({ id: "3b", ts: T(2026, 1, 11, 9), channel: null, channelId: null }),
	// No channelId but a real video id: a name-only channel, grouped by name.
	yt({
		id: "4",
		ts: T(2026, 2, 1, 23),
		channel: "Gamma",
		channelId: null,
		videoId: "v4",
	}),
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

/**
 * Rows Takeout never attributed to a channel. Both shapes are taken verbatim
 * from a real 2022-2025 export (`Des recommandations...` 429x, survey answers
 * 19x) plus the no-subtitles shape seen in both exports.
 */
const FAKE: StreamRecord[] = [
	yt({
		id: "f1",
		ts: T(2026, 1, 12, 9),
		channel: "Des recommandations basées sur la position ont été fournies",
		channelId: null,
		videoId: null,
	}),
	yt({
		id: "f2",
		ts: T(2026, 1, 12, 10),
		channel: "Réponse : Adobe Studio",
		channelId: null,
		videoId: null,
	}),
	yt({ id: "f3", ts: T(2026, 1, 13, 9), channel: null, channelId: null }),
];

describe("topChannels with unattributable rows", () => {
	it("never invents a channel for them", () => {
		const list = topChannels([...R, ...FAKE], RANGE);
		const names = list.map((c) => c.channel);
		expect(names).not.toContain("(unknown channel)");
		expect(names.some((n) => n.startsWith("Des recommandations"))).toBe(false);
		expect(names.some((n) => n.startsWith("Réponse"))).toBe(false);
		// The real channels still rank exactly as before.
		expect(names).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("keeps a name-only channel whose subtitle url is not a channel path", () => {
		// Structural rule, not a French-string blocklist: a name plus a real
		// video id is a channel even without a UC id.
		const row = yt({
			id: "n1",
			ts: T(2026, 1, 14, 9),
			channel: "Une chaîne sans identifiant",
			channelId: null,
			videoId: "vX",
		});
		const list = topChannels([row], RANGE);
		expect(list.map((c) => c.channel)).toEqual(["Une chaîne sans identifiant"]);
	});

	it("still drops ad-driven rows on top of the attribution filter", () => {
		const list = topChannels([...R, ...FAKE], RANGE, { includeAds: true });
		expect(list.some((c) => c.channel === "Ads")).toBe(true);
		expect(list.some((c) => c.channel === "(unknown channel)")).toBe(false);
	});
});

describe("hourHistogram / weekdayHistogram", () => {
	it("counts by local hour", () => {
		const h = hourHistogram(R, RANGE);
		expect(h[9]).toBe(3); // rows 1, 3 and 3b
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
		// 5 organic rows from R (ad + music excluded) + 4 of the 5 added
		// in-range youtube rows ("music-ads" excluded) = 9 counted.
		expect(merged.hours.reduce((a, b) => a + b, 0)).toBe(9);
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
		// R: Mon 01-05, Tue 01-06, Sun 01-11, Sat 01-10, Sun 02-01
		// (ad + music excluded; 3b counts - it is a view, just not a channel).
		expect(merged.weekdays).toEqual([1, 1, 0, 0, 0, 1, 2]);
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
		expect(trend.map((p) => p.plays)).toEqual([4, 1, 0]); // Jan, Feb, Mar
	});

	it("summarizes youtube kind only", () => {
		const s = youtubeSummary(R, { from: 0, to: Number.MAX_SAFE_INTEGER });
		// ad row excluded, music row excluded. totalPlays keeps matching the
		// trend line and the histograms, which count the same rows.
		expect(s.totalPlays).toBe(5);
		expect(s.uniqueChannels).toBe(3);
		// Only row 3b (no channel, no video) is unattributable.
		expect(s.unattributed).toBe(1);
	});

	it("counts fake channels as plays but not as channels", () => {
		const s = youtubeSummary([...R, ...FAKE], {
			from: 0,
			to: Number.MAX_SAFE_INTEGER,
		});
		expect(s.totalPlays).toBe(8); // 5 + 3
		expect(s.uniqueChannels).toBe(3); // Alpha, Beta, Gamma
		expect(s.unattributed).toBe(4); // the 3 fake rows + row 3b
	});
});
