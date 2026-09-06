import { describe, expect, it } from "vitest";
import { matchLikes } from "@/analytics/likes";
import type { StreamRecord } from "@/db/types";
import { parseLikesFile } from "./likesParse";

describe("parseLikesFile", () => {
	it("parses a Takeout-style playlist CSV with commas in titles", () => {
		const csv = [
			'"Video Id","Video Title","Channel Name","Date Created"',
			'"KyOJZuuX-7k","Old Hundreds, Live Version","Release - Topic","2026-01-01"',
			'"THHomD0dElY","Future - Mask Off","Future - Topic","2026-01-02"',
		].join("\n");
		const likes = parseLikesFile(csv, "Liked music.csv");
		expect(likes).toHaveLength(2);
		expect(likes[0]?.videoId).toBe("KyOJZuuX-7k");
		expect(likes[0]?.title).toBe("Old Hundreds, Live Version");
		expect(likes[0]?.channel).toBe("Release - Topic");
	});

	it("handles variant headers (Song Title / Artist Name)", () => {
		const csv = ['"Song Title","Artist Name"', '"Mask Off","Future"'].join(
			"\n",
		);
		const likes = parseLikesFile(csv, "Liked music.csv");
		expect(likes).toHaveLength(1);
		expect(likes[0]?.title).toBe("Mask Off");
		expect(likes[0]?.channel).toBe("Future");
		expect(likes[0]?.videoId).toBeNull();
	});

	it("returns [] for unrecognizable content", () => {
		expect(parseLikesFile("some random,text\nrow,here", "x.csv")).toEqual([]);
		expect(parseLikesFile("", "x.csv")).toEqual([]);
	});
});

describe("matchLikes", () => {
	const rec = (over: Partial<StreamRecord>): StreamRecord => ({
		id: over.id ?? Math.random().toString(36).slice(2),
		ts: 0,
		kind: "music",
		videoId: null,
		title: "Song",
		rawTitle: "Vous avez regardé Song",
		artist: "Future",
		artistKey: "future",
		artistConfidence: "topic",
		channel: "Future - Topic",
		channelId: null,
		adDriven: false,
		...over,
	});

	const records: StreamRecord[] = [
		rec({ videoId: "vidFuture1", title: "Mask Off" }),
		rec({
			id: "r2",
			artist: "Lil Baby",
			artistKey: "lil baby",
			channel: "Lil Baby - Topic",
			title: "Drip Too Hard",
		}),
	];

	it("matches by videoId first", () => {
		const m = matchLikes(
			[
				{
					id: "l1",
					videoId: "vidFuture1",
					title: "Whatever Display",
					channel: null,
					addedAt: null,
					sourceFile: "x",
				},
			],
			records,
		);
		expect(m.matched).toBe(1);
		expect(m.byArtist.get("future")).toBe(1);
	});

	it("falls back to (artist, cleaned-track) matching", () => {
		const m = matchLikes(
			[
				{
					id: "l2",
					videoId: null,
					title: "Drip Too Hard (Official Video)",
					channel: "Lil Baby",
					addedAt: null,
					sourceFile: "x",
				},
			],
			records,
		);
		expect(m.matched).toBe(1);
		expect(m.byArtist.get("lil baby")).toBe(1);
	});

	it("counts unmatched likes separately", () => {
		const m = matchLikes(
			[
				{
					id: "l3",
					videoId: "ghost00001",
					title: "Unknown Song",
					channel: "Nobody",
					addedAt: null,
					sourceFile: "x",
				},
			],
			records,
		);
		expect(m.matched).toBe(0);
		expect(m.unmatched).toBe(1);
		expect(m.total).toBe(1);
		expect(m.byArtist.size).toBe(0);
	});
});
