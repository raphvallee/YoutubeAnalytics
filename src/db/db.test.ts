import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	allArtistOrigins,
	clearArtistOrigins,
	clearDataset,
	db,
	deleteSnapshot,
	getDatasetMeta,
	listSnapshots,
	loadSnapshotRecords,
	putArtistOrigins,
	replaceDataset,
	saveSnapshot,
} from "./db";
import type { ArtistOrigin, StreamRecord } from "./types";

function rec(overrides: Partial<StreamRecord>): StreamRecord {
	return {
		id: overrides.id ?? Math.random().toString(36).slice(2),
		ts: 1_700_000_000_000,
		kind: "music",
		videoId: "vid00000001",
		title: "Track",
		rawTitle: "Vous avez regardé Track",
		artist: "Artist",
		artistKey: "artist",
		artistConfidence: "topic",
		channel: "Artist - Topic",
		channelId: "UC000",
		adDriven: false,
		...overrides,
	};
}

beforeEach(async () => {
	await clearDataset();
});

describe("replaceDataset / getDatasetMeta", () => {
	it("replaces the dataset and computes meta aggregates", async () => {
		const records = [
			rec({
				id: "a",
				kind: "music",
				artist: "Future",
				artistKey: "future",
				ts: 1000,
			}),
			rec({ id: "b", kind: "music", artist: null, artistKey: "", ts: 2000 }),
			rec({ id: "c", kind: "youtube", artist: null, artistKey: "", ts: 500 }),
		];
		const summary = await replaceDataset(records, 1, {
			duplicateCount: 4,
			droppedCount: 2,
			prefixesSeen: ["Vous avez regardé "],
		});

		expect(summary.rowCount).toBe(3);
		expect(summary.musicCount).toBe(2);
		expect(summary.youtubeCount).toBe(1);
		expect(summary.unattributedMusic).toBe(1);
		expect(summary.minTs).toBe(500);
		expect(summary.maxTs).toBe(2000);
		expect(summary.duplicateCount).toBe(4);
		expect(summary.droppedCount).toBe(2);

		const meta = await getDatasetMeta();
		expect(meta?.rowCount).toBe(3);
		expect(meta?.schemaVersion).toBe(1);
	});

	it("clears previous rows on re-import (replace semantics)", async () => {
		await replaceDataset([rec({ id: "old" })], 1, {
			duplicateCount: 0,
			droppedCount: 0,
			prefixesSeen: [],
		});
		await replaceDataset([rec({ id: "new" })], 2, {
			duplicateCount: 0,
			droppedCount: 0,
			prefixesSeen: [],
		});
		const all = await db.streams.toArray();
		expect(all.map((r) => r.id)).toEqual(["new"]);
		expect((await getDatasetMeta())?.fileCount).toBe(2);
	});
});

describe("clearDataset", () => {
	it("removes streams and meta", async () => {
		await replaceDataset([rec({ id: "x" })], 1, {
			duplicateCount: 0,
			droppedCount: 0,
			prefixesSeen: [],
		});
		await clearDataset();
		expect(await db.streams.count()).toBe(0);
		expect(await getDatasetMeta()).toBeUndefined();
	});
});

describe("snapshots", () => {
	beforeEach(async () => {
		const existing = await listSnapshots();
		for (const s of existing) await deleteSnapshot(s.id);
	});

	it("round-trips name + records, lists newest first", async () => {
		const records = [rec({ id: "a" }), rec({ id: "b" })];
		const meta = await saveSnapshot("before second export", records);
		// createdAt has ms resolution: guarantee the second save sorts newer.
		await new Promise((r) => setTimeout(r, 2));
		await saveSnapshot("older", records);

		const list = await listSnapshots();
		expect(list).toHaveLength(2);
		expect(list[0]?.name).toBe("older");
		expect(list[1]?.name).toBe("before second export");
		expect(list[1]?.rowCount).toBe(2);

		const loaded = await loadSnapshotRecords(meta.id);
		expect(loaded?.map((r) => r.id)).toEqual(["a", "b"]);
	});

	it("delete removes meta and data", async () => {
		const meta = await saveSnapshot("gone soon", [rec({ id: "a" })]);
		await deleteSnapshot(meta.id);
		expect(await listSnapshots()).toHaveLength(0);
		expect(await loadSnapshotRecords(meta.id)).toBeNull();
	});
});

describe("artistOrigins cache", () => {
	const origin = (
		artistKey: string,
		overrides?: Partial<ArtistOrigin>,
	): ArtistOrigin => ({
		artistKey,
		artistName: "Artist",
		mbid: "mbid-1",
		resolvedName: "Artist",
		precision: "city",
		placeName: "Stockholm",
		subdivisionName: null,
		countryName: "Sweden",
		countryCode: "SE",
		lat: 59.33,
		lng: 18.06,
		resolvedAt: 1,
		...overrides,
	});

	beforeEach(async () => {
		await clearArtistOrigins();
	});

	it("bulk-puts and overwrites by artistKey", async () => {
		await putArtistOrigins([origin("artist")]);
		await putArtistOrigins([
			origin("artist", {
				precision: "country",
				placeName: null,
				lat: null,
				lng: null,
			}),
			origin("other"),
		]);
		const all = await allArtistOrigins();
		expect(all).toHaveLength(2);
		expect(all.find((r) => r.artistKey === "artist")?.precision).toBe(
			"country",
		);
	});

	it("survives clearDataset - origins are cache, not dataset", async () => {
		await putArtistOrigins([
			origin("artist"),
			origin("miss", { precision: "miss", mbid: null, lat: null, lng: null }),
		]);
		await replaceDataset([rec({ id: "x" })], 1, {
			duplicateCount: 0,
			droppedCount: 0,
			prefixesSeen: [],
		});
		await clearDataset();
		expect(await db.streams.count()).toBe(0);
		expect(await getDatasetMeta()).toBeUndefined();
		const all = await allArtistOrigins();
		expect(all).toHaveLength(2);
	});
});
