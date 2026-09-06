import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import {
	hourHistogram,
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
