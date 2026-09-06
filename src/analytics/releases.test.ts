import { describe, expect, it } from "vitest";
import type { MbRelease, StreamRecord } from "@/db/types";
import { topReleases } from "./releases";

const RANGE = { from: 0, to: 10 };

function rec(
	id: string,
	channelId: string | null,
	ts = 1,
	kind: "music" | "youtube" = "music",
): StreamRecord {
	return {
		id,
		ts,
		kind,
		videoId: "vid",
		title: "T",
		rawTitle: "T",
		artist: null,
		artistKey: "",
		artistConfidence: "unknown",
		channel: "Release - Topic",
		channelId,
		adDriven: false,
	};
}

function rel(channelId: string, releaseName: string | null): MbRelease {
	return {
		channelId,
		releaseName,
		artistName: releaseName ? "Artist" : null,
		date: "2020-01-01",
		query: "q",
		resolvedAt: 1,
	};
}

describe("topReleases", () => {
	it("joins enriched channelIds to play counts, sorted by plays", () => {
		const agg = topReleases(
			[
				rec("a", "UC1"),
				rec("b", "UC1"),
				rec("c", "UC2"),
				rec("d", "UC3"), // unresolved release - hidden
				rec("e", "UC1", 1, "youtube"), // wrong kind - hidden
			],
			[rel("UC1", "Album One"), rel("UC2", null), rel("UC3", null)],
			RANGE,
		);
		expect(agg).toEqual([
			{
				channelId: "UC1",
				releaseName: "Album One",
				artistName: "Artist",
				date: "2020-01-01",
				plays: 2,
			},
		]);
	});

	it("counts stay within range", () => {
		const agg = topReleases(
			[rec("a", "UC1", 1), rec("b", "UC1", 99)],
			[rel("UC1", "Album")],
			RANGE,
		);
		expect(agg[0]?.plays).toBe(1);
	});
});
