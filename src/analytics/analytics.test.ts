import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import { autoBucket, bucketKey, buildBucketSpans } from "./buckets";
import {
	availableYears,
	macroSeries,
	musicSummary,
	scopedSeries,
	topArtists,
	topTracks,
	trackErasSeries,
} from "./queries";

// Local-noon constructors: tests must not depend on the machine timezone.
const T = (y: number, m: number, d: number) =>
	new Date(y, m - 1, d, 12).getTime();

function rec(
	partial: Partial<StreamRecord> & { id: string; ts: number },
): StreamRecord {
	return {
		kind: "music",
		videoId: null,
		title: "Song",
		rawTitle: "Vous avez regardé Song",
		artist: "A",
		artistKey: "a",
		artistConfidence: "topic",
		channel: "A - Topic",
		channelId: null,
		adDriven: false,
		...partial,
	};
}

const R: StreamRecord[] = [
	rec({
		id: "1",
		ts: T(2026, 1, 5),
		artist: "A",
		artistKey: "a",
		title: "Song One",
	}),
	rec({
		id: "2",
		ts: T(2026, 1, 6),
		artist: "A",
		artistKey: "a",
		title: "Song One",
	}),
	rec({
		id: "3",
		ts: T(2026, 1, 20),
		artist: "B",
		artistKey: "b",
		title: "Song Two",
	}),
	rec({
		id: "4",
		ts: T(2026, 2, 14),
		artist: "A",
		artistKey: "a",
		title: "Song Three (feat. X)",
	}),
	rec({
		id: "5",
		ts: T(2026, 2, 15),
		artist: "A",
		artistKey: "a",
		title: "Song Three",
	}),
	rec({
		id: "6",
		ts: T(2026, 3, 8),
		artist: "C",
		artistKey: "c",
		title: "Song Four",
	}),
	rec({
		id: "7",
		ts: T(2026, 3, 9),
		artist: null,
		artistKey: "",
		title: "Unattributed",
	}),
	rec({
		id: "8",
		ts: T(2026, 3, 10),
		artist: "D",
		artistKey: "d",
		title: "Ad Song",
		adDriven: true,
	}),
	rec({
		id: "9",
		ts: T(2025, 6, 1),
		artist: "A",
		artistKey: "a",
		title: "Song One",
		kind: "youtube",
	}),
];

const RANGE = { from: T(2026, 1, 1), to: T(2026, 3, 31) };

describe("buckets", () => {
	it("produces contiguous, gap-free spans", () => {
		const spans = buildBucketSpans(RANGE.from, RANGE.to, "month");
		expect(spans.map((s) => s.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
		for (let i = 1; i < spans.length; i++) {
			expect(spans[i]?.start).toBe(spans[i - 1]?.end);
		}
	});

	it("keys ISO weeks and years", () => {
		expect(bucketKey(T(2026, 1, 5), "week")).toBe("2026-W02");
		expect(bucketKey(T(2026, 1, 5), "year")).toBe("2026");
	});

	it("auto-picks granularity by span length", () => {
		expect(autoBucket(T(2026, 1, 1), T(2026, 3, 1))).toBe("week");
		expect(autoBucket(T(2020, 1, 1), T(2026, 1, 1))).toBe("year");
	});
});

describe("topArtists", () => {
	it("ranks by plays, excludes unattributed and ad-driven", () => {
		const list = topArtists(R, RANGE, {}, 10);
		expect(list.map((a) => a.artistKey)).toEqual(["a", "b", "c"]); // d is ad-driven, '' unattributed
		expect(list[0]?.plays).toBe(4); // 3 music plays in 2026 + ... actually a: rows 1,2,4,5 = 4
	});

	it("respects the range", () => {
		const jan = topArtists(R, { from: T(2026, 1, 1), to: T(2026, 1, 31) });
		expect(jan.map((a) => a.artistKey)).toEqual(["a", "b"]);
	});
});

describe("topTracks", () => {
	it("groups feat variants into one track key", () => {
		const list = topTracks(R, RANGE);
		const songThree = list.find((t) => t.trackKey === "song three");
		expect(songThree?.plays).toBe(2);
	});

	it("scopes to an artist", () => {
		const list = topTracks(R, RANGE, {}, { artistKey: "a" });
		expect(list.every((t) => t.artistKey === "a")).toBe(true);
	});
});

describe("scopedSeries", () => {
	it("gap-fills zero buckets", () => {
		const points = scopedSeries(
			R,
			RANGE,
			"month",
			{},
			{ kind: "music", artistKey: "a" },
		);
		expect(points.map((p) => p.plays)).toEqual([2, 2, 0]); // Mar has no A plays
		expect(points.map((p) => p.key)).toEqual(["2026-01", "2026-02", "2026-03"]);
	});

	it("sums to the artist total", () => {
		const points = scopedSeries(
			R,
			RANGE,
			"week",
			{},
			{ kind: "music", artistKey: "a" },
		);
		expect(points.reduce((s, p) => s + p.plays, 0)).toBe(4);
	});
});

describe("macroSeries", () => {
	it("folds non-top artists into Other", () => {
		const { rows, seriesNames } = macroSeries(R, RANGE, { topN: 2 });
		expect(seriesNames).toEqual(["A", "B", "Other"]);
		const mar = rows.find((r) => r.key === "2026-03");
		expect(mar?.Other).toBe(1); // C folds in; ad-driven D excluded
		expect(mar?.A).toBe(0); // gap months present as zeros
	});
});

describe("trackErasSeries", () => {
	it("stacks top tracks per month", () => {
		const { rows, seriesNames } = trackErasSeries(R, RANGE, { topN: 3 });
		expect(seriesNames).toEqual([
			"Song One",
			"Song Three (feat. X)",
			"Song Four",
		]);
		const jan = rows.find((r) => r.key === "2026-01");
		expect(jan?.["Song One"]).toBe(2);
	});
});

describe("availableYears / musicSummary", () => {
	it("lists dataset years", () => {
		expect(availableYears(R)).toEqual([2025, 2026]);
	});

	it("summarizes music only", () => {
		const s = musicSummary(R, { from: 0, to: Number.MAX_SAFE_INTEGER });
		expect(s.totalPlays).toBe(7); // excludes the youtube-kind row and the ad-driven one
		expect(s.uniqueArtists).toBe(3);
		expect(s.unattributed).toBe(1);
	});
});
