import { describe, expect, it } from "vitest";
import fixtureJson from "../test/fixtures/takeout-fixture.json";
import type { RawTakeoutEntry } from "./normalize";
import {
	classifyKind,
	extractVideoId,
	normalizeBatch,
	normalizeEntry,
} from "./normalize";

const fixture = fixtureJson as RawTakeoutEntry[];

function entryAt(i: number): RawTakeoutEntry {
	const e = fixture[i];
	if (!e) throw new Error(`fixture row ${i} missing`);
	return e;
}

function ingest(entries: RawTakeoutEntry[]) {
	const stats = {
		prefixesSeen: [] as string[],
		droppedCount: 0,
		droppedSearch: 0,
		droppedBadTime: 0,
	};
	return normalizeBatch(entries, new Set(), stats).then((records) => ({
		records,
		stats,
	}));
}

describe("classifyKind", () => {
	it("music wins on header, then on music.youtube.com host", () => {
		expect(classifyKind("YouTube Music")).toBe("music");
		expect(classifyKind("YouTube", "https://music.youtube.com/watch?v=x")).toBe(
			"music",
		);
		expect(classifyKind("YouTube", "https://www.youtube.com/watch?v=x")).toBe(
			"youtube",
		);
	});

	it("tolerates the non-breaking space real Takeout writes in the header", () => {
		// eslint-disable-next-line no-irregular-whitespace -- that IS the regression
		expect(classifyKind("YouTube Music")).toBe("music");
	});
});

describe("extractVideoId", () => {
	it("decodes escaped URLs and pulls the v param", () => {
		expect(
			extractVideoId("https://music.youtube.com/watch?v=KyOJZuuX-7k"),
		).toBe("KyOJZuuX-7k");
		expect(extractVideoId(undefined)).toBeNull();
		expect(extractVideoId("not a url")).toBeNull();
	});
});

describe("normalizeEntry on fixture rows", () => {
	it("keeps a topic-channel music row with high-confidence artist", () => {
		const r = normalizeEntry(entryAt(0));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.kind).toBe("music");
		expect(r.record.artist).toBe("YC Worldwide");
		expect(r.record.artistConfidence).toBe("topic");
		expect(r.record.videoId).toBe("KyOJZuuX-7k");
	});

	it("poison-guards Release - Topic with no recoverable artist", () => {
		const r = normalizeEntry(entryAt(1));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.artist).toBeNull();
		expect(r.record.artistConfidence).toBe("unknown");
		expect(r.record.title).toBe("Old Hundreds");
	});

	it("recovers artist from title when channel is Release - Topic", () => {
		const r = normalizeEntry(entryAt(2));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.artist).toBe("Future");
		expect(r.record.artistConfidence).toBe("parsed");
	});

	it("keeps youtube rows with plain channel and no artist", () => {
		const r = normalizeEntry(entryAt(3));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.kind).toBe("youtube");
		expect(r.record.channel).toBe("Data Engineering Channel");
		expect(r.record.artist).toBeNull();
		expect(r.record.channelId).toBe("UCdataengineer00");
	});

	it("keeps deleted videos (no titleUrl) with null videoId", () => {
		const r = normalizeEntry(entryAt(4));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.videoId).toBeNull();
	});

	it("flags ad-driven rows", () => {
		const r = normalizeEntry(entryAt(5));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.adDriven).toBe(true);
	});

	it("drops search rows", () => {
		expect(normalizeEntry(entryAt(6))).toMatchObject({ drop: "search" });
	});

	it("drops rows without a valid time", () => {
		expect(normalizeEntry(entryAt(7))).toMatchObject({ drop: "badTime" });
	});

	it("classifies music via music.youtube.com host even with header YouTube", () => {
		const r = normalizeEntry(entryAt(10));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.kind).toBe("music");
		expect(r.record.artist).toBe("Whatever");
	});

	it("strips official-video decoration from display title", () => {
		const r = normalizeEntry(entryAt(11));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.record.title).toBe("Dua Lipa - Training Season");
		expect(r.record.artist).toBe("Dua Lipa");
	});

	it("reports unknown-locale rows with (none) prefix but keeps them", () => {
		const r = normalizeEntry(entryAt(9));
		if (!("record" in r)) throw new Error("expected record");
		expect(r.prefixSeen).toBe("(none)");
	});
});

describe("normalizeBatch over the fixture", () => {
	it("yields 9 records, drops 2, dedupes the repeated entry", async () => {
		const { records, stats } = await ingest(fixture);
		expect(records).toHaveLength(9);
		expect(stats.droppedCount).toBe(2);
		// 12 entries - 9 kept - 2 dropped = 1 in-batch duplicate
		expect(fixture.length - records.length - stats.droppedCount).toBe(1);
		expect(stats.prefixesSeen).toEqual(["Vous avez regardé ", "(none)"]);
	});

	it("sorts by ts ascending and dedupes across batches via existingIds", async () => {
		const stats = {
			prefixesSeen: [],
			droppedCount: 0,
			droppedSearch: 0,
			droppedBadTime: 0,
		};
		const first = await normalizeBatch(fixture, new Set(), stats);
		const second = await normalizeBatch(
			fixture,
			new Set(first.map((r) => r.id)),
			stats,
		);
		expect(second).toHaveLength(0);
		expect(first.map((r) => r.ts)).toEqual(
			[...first].sort((a, b) => a.ts - b.ts).map((r) => r.ts),
		);
	});
});
