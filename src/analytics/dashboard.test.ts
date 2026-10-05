import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import {
	artistDashboard,
	ERAS_SERIES,
	likesDashboard,
	musicDashboard,
	originPlays,
	videoDashboard,
} from "./dashboard";
import {
	availableYears,
	macroSeries,
	musicSummary,
	scopedSeries,
	topArtists,
	topTracks,
	trackErasSeries,
} from "./queries";
import {
	hourWeekdayHistogram,
	topChannels,
	youtubeSummary,
	youtubeTrend,
} from "./youtube";

/**
 * The bundles in `./dashboard.ts` are what the worker actually answers with, so
 * they are held to the same numbers the per-query functions have always
 * produced. Each case below pins a bundle against the individual functions it
 * replaced - if an aggregation changes, both sides move together only if the
 * change is intended; an accidental drift in the bundle fails here.
 */

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
		title: "One",
	}),
	rec({
		id: "2",
		ts: T(2026, 1, 20),
		artist: "B",
		artistKey: "b",
		title: "Two (Official Video)",
	}),
	rec({
		id: "3",
		ts: T(2025, 3, 2),
		artist: "A",
		artistKey: "a",
		title: "One",
	}),
	rec({
		id: "4",
		ts: T(2026, 1, 6),
		kind: "youtube",
		artist: null,
		artistKey: "",
		title: "A video",
		channel: "Chan",
		channelId: "UC1",
	}),
	rec({
		id: "5",
		ts: T(2026, 1, 7),
		artist: null,
		artistKey: "",
		title: "Unattributed",
		channel: "Release - Topic",
	}),
	rec({
		id: "6",
		ts: T(2026, 1, 8),
		artist: "C",
		artistKey: "c",
		title: "Three",
		adDriven: true,
	}),
];

const ALL: { from: number; to: number } = {
	from: T(2020, 1, 1),
	to: T(2027, 1, 1),
};
const JAN26: { from: number; to: number } = {
	from: T(2026, 1, 1),
	to: T(2026, 2, 1),
};

describe("musicDashboard", () => {
	it("matches the individual queries for the same range", () => {
		const d = musicDashboard(R, ALL);
		const tracks = topTracks(R, ALL, {}, { limit: 25 });

		expect(d.years).toEqual(availableYears(R));
		expect(d.summary).toEqual(musicSummary(R, ALL));
		expect(d.artists).toEqual(topArtists(R, ALL, {}, 25));
		expect(d.tracks).toEqual(tracks);
		expect(d.macro.rows).toEqual(
			macroSeries(R, ALL, { bucket: "month", topN: 8 }).rows,
		);
		expect(d.macro.seriesNames).toEqual(
			macroSeries(R, ALL, { bucket: "month", topN: 8 }).seriesNames,
		);
		// The leaderboard's own ranking feeds the era chart, so the two agree on
		// which tracks are "the top 8".
		expect(d.eras.seriesNames).toEqual(
			trackErasSeries(R, ALL, {
				bucket: "month",
				topN: ERAS_SERIES,
				tracks: tracks.slice(0, ERAS_SERIES),
			}).seriesNames,
		);
		expect(d.eras.rows).toEqual(
			trackErasSeries(R, ALL, {
				bucket: "month",
				topN: ERAS_SERIES,
				tracks: tracks.slice(0, ERAS_SERIES),
			}).rows,
		);
	});

	it("reuses the leaderboard ranking instead of ranking twice", () => {
		// More than ERAS_SERIES distinct tracks, so slicing the 25-row
		// leaderboard genuinely picks the same set as a dedicated top-8 call.
		const many = Array.from({ length: 12 }, (_, i) =>
			rec({
				id: `m${i}`,
				ts: T(2026, 1, 1 + i),
				artist: "A",
				artistKey: "a",
				title: `Track ${i}`,
			}),
		);
		const d = musicDashboard(many, ALL);
		expect(d.eras.seriesNames).toHaveLength(ERAS_SERIES);
		expect(d.eras.seriesNames).toEqual(
			trackErasSeries(many, ALL, { bucket: "month", topN: ERAS_SERIES })
				.seriesNames,
		);
	});

	it("excludes ad-driven and youtube rows from the music aggregates", () => {
		const d = musicDashboard(R, ALL);
		// Rows 1, 2, 3 are organic music; 4 is youtube, 5 unattributed music
		// (counted as a play, not an artist), 6 is ad-driven.
		expect(d.summary.totalPlays).toBe(4);
		expect(d.summary.uniqueArtists).toBe(2);
		expect(d.summary.unattributed).toBe(1);
		expect(d.artists.map((a) => a.artistKey)).toEqual(["a", "b"]);
	});
});

describe("artistDashboard", () => {
	it("matches scopedSeries + topTracks + trackErasSeries for one artist", () => {
		const d = artistDashboard(R, JAN26, "a", "week");
		expect(d.affinity).toEqual(
			scopedSeries(R, JAN26, "week", {}, { kind: "music", artistKey: "a" }),
		);
		expect(d.tracks).toEqual(
			topTracks(R, JAN26, {}, { artistKey: "a", limit: 10 }),
		);
		expect(d.eras.seriesNames).toEqual(
			trackErasSeries(R, JAN26, {
				bucket: "month",
				topN: ERAS_SERIES,
				artistKey: "a",
			}).seriesNames,
		);
	});

	it("totals only the scoped artist's plays", () => {
		const d = artistDashboard(R, JAN26, "a", "week");
		expect(d.affinityTotal).toBe(
			d.affinity.reduce((sum, p) => sum + p.plays, 0),
		);
		expect(d.affinityTotal).toBe(1);
		expect(d.tracks.every((t) => t.artistKey === "a")).toBe(true);
	});
});

describe("videoDashboard", () => {
	it("matches the individual queries for the same range", () => {
		const d = videoDashboard(R, ALL, "month");
		const histograms = hourWeekdayHistogram(R, ALL);
		expect(d.years).toEqual(availableYears(R));
		expect(d.summary).toEqual(youtubeSummary(R, ALL));
		expect(d.channels).toEqual(topChannels(R, ALL, {}, 25));
		expect(d.hours).toEqual(histograms.hours);
		expect(d.weekdays).toEqual(histograms.weekdays);
		expect(d.trend).toEqual(youtubeTrend(R, ALL, "month"));
	});

	it("carries both histogram axes in the two shapes the page renders", () => {
		const d = videoDashboard(R, ALL, "month");
		expect(d.hours).toHaveLength(24);
		expect(d.weekdays).toHaveLength(7);
	});
});

describe("likesDashboard", () => {
	it("answers zero matched when nothing is uploaded", () => {
		const d = likesDashboard(R, []);
		expect(d.total).toBe(0);
		expect(d.matched).toBe(0);
		expect(d.byArtist.size).toBe(0);
	});

	it("matches a liked track to its artist by video id", () => {
		const withIds = R.map((r, i) => ({ ...r, videoId: `v${i}` }));
		// v1 is row "2", which belongs to artist B.
		const d = likesDashboard(withIds, [
			{
				id: "l1",
				videoId: "v1",
				title: "whatever",
				channel: null,
				addedAt: null,
				sourceFile: "likes.csv",
			},
		]);
		expect(d.matched).toBe(1);
		expect(d.unmatched).toBe(0);
		expect(d.byArtist.get("b")).toBe(1);
	});
});

describe("originPlays", () => {
	it("ranks lifetime plays per attributed artist and ignores ad rows", () => {
		const totals = originPlays(R);
		expect([...totals.entries()].map(([k, v]) => [k, v.plays])).toEqual([
			["a", 2],
			["b", 1],
		]);
	});

	it("keeps the display name for the map's labels", () => {
		expect(originPlays(R).get("b")?.artist).toBe("B");
	});
});
