import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import { compareArtists, playsByArtistKey } from "./compare";

const RANGE = { from: 0, to: 10 };

function rec(
	id: string,
	artistKey: string,
	ts: number,
	adDriven = false,
): StreamRecord {
	return {
		id,
		ts,
		kind: "music",
		videoId: "vid",
		title: "T",
		rawTitle: "T",
		artist: artistKey,
		artistKey,
		artistConfidence: "topic",
		channel: null,
		channelId: null,
		adDriven,
	};
}

describe("playsByArtistKey", () => {
	it("counts organic music plays per artist in range", () => {
		const counts = playsByArtistKey(
			[
				rec("a", "future", 1),
				rec("b", "future", 2),
				rec("c", "lil", 3),
				rec("d", "", 4), // unattributed excluded
				rec("e", "ads", 5, true), // ad-driven excluded
				rec("f", "lil", 99), // out of range
			],
			RANGE,
		);
		expect(counts.get("future")).toBe(2);
		expect(counts.get("lil")).toBe(1);
		expect(counts.has("ads")).toBe(false);
		expect(counts.has("")).toBe(false);
	});
});

describe("compareArtists", () => {
	it("joins snapshot plays and computes pct deltas", () => {
		const current = [
			{ artistKey: "future", plays: 15 },
			{ artistKey: "lil", plays: 4 },
			{ artistKey: "new", plays: 7 },
		];
		const snapshot = [
			rec("s1", "future", 1),
			rec("s2", "future", 2),
			rec("s3", "future", 3),
			rec("s4", "future", 4),
			rec("s5", "future", 5),
			rec("s6", "future", 6), // 6 plays
			rec("s7", "lil", 7), // 1 play
		];
		const deltas = compareArtists(current, snapshot, RANGE);
		expect(deltas.get("future")).toEqual({ snap: 6, pct: 1.5 });
		expect(deltas.get("lil")).toEqual({ snap: 1, pct: 3 });
		expect(deltas.get("new")).toEqual({ snap: 0, pct: null }); // absent = new
	});

	it("zero-play snapshot artist yields null pct, not Infinity", () => {
		const deltas = compareArtists(
			[{ artistKey: "future", plays: 3 }],
			[rec("s1", "lil", 1)],
			RANGE,
		);
		expect(deltas.get("future")).toEqual({ snap: 0, pct: null });
	});
});
