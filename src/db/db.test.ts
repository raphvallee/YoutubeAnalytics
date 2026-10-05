import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
	allArtistOrigins,
	clearArtistOrigins,
	clearDataset,
	clearLikes,
	commitDataset,
	db,
	deleteSnapshot,
	getDatasetMeta,
	listSnapshots,
	loadSnapshotRecords,
	putArtistOrigins,
	replaceDataset,
	saveSnapshot,
} from "./db";
import type { ArtistOrigin, LikedTrack, StreamRecord } from "./types";

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

describe("commitDataset in add mode", () => {
	const stats = {
		duplicateCount: 0,
		droppedCount: 0,
		prefixesSeen: [] as string[],
	};

	beforeEach(async () => {
		await clearLikes();
	});

	it("keeps existing rows and appends new ones", async () => {
		await commitDataset(
			[rec({ id: "old", ts: 1000, kind: "music", artistKey: "a" })],
			1,
			stats,
			{ mode: "replace" },
		);

		const summary = await commitDataset(
			[
				rec({ id: "new", ts: 2000, kind: "youtube", artistKey: "" }),
				rec({ id: "newer", ts: 3000, kind: "youtube", artistKey: "" }),
			],
			1,
			stats,
			{ mode: "add" },
		);

		expect(await db.streams.count()).toBe(3);
		expect(summary.insertedCount).toBe(2);
		expect(summary.overlapCount).toBe(0);
		expect(summary.replaced).toBe(false);
		expect(summary.rowCount).toBe(3);
		expect((await getDatasetMeta())?.fileCount).toBe(2);
	});

	it("recomputes aggregates over the merged set, not just the new rows", async () => {
		await commitDataset(
			[
				rec({ id: "a", ts: 5000, kind: "music", artistKey: "a" }),
				rec({ id: "b", ts: 9000, kind: "music", artistKey: "b", artist: null }),
			],
			1,
			stats,
			{ mode: "replace" },
		);

		const summary = await commitDataset(
			[rec({ id: "c", ts: 1000, kind: "youtube", artistKey: "" })],
			1,
			stats,
			{ mode: "add" },
		);

		// minTs must widen to the row only the new file knew about, and the
		// music/youtube split must cover all three rows.
		expect(summary.minTs).toBe(1000);
		expect(summary.maxTs).toBe(9000);
		expect(summary.musicCount).toBe(2);
		expect(summary.youtubeCount).toBe(1);
		expect(summary.unattributedMusic).toBe(1);
		expect(summary.rowCount).toBe(3);
	});

	it("last writer wins on an id collision (Takeout edits a play in place)", async () => {
		await commitDataset(
			[
				rec({
					id: "same",
					title: "Old Title",
					adDriven: false,
					channel: null,
				}),
			],
			1,
			stats,
			{ mode: "replace" },
		);

		const summary = await commitDataset(
			[
				rec({
					id: "same",
					title: "Corrected Title",
					adDriven: true,
					channel: "Artist - Topic",
				}),
			],
			1,
			stats,
			{ mode: "add" },
		);

		const rows = await db.streams.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe("Corrected Title");
		expect(rows[0]?.adDriven).toBe(true);
		expect(summary.overlapCount).toBe(1);
		expect(summary.insertedCount).toBe(0);
	});

	it("accumulates drop/duplicate counters and prefixes across imports", async () => {
		await commitDataset(
			[rec({ id: "a" })],
			1,
			{
				duplicateCount: 2,
				droppedCount: 3,
				prefixesSeen: ["Vous avez regardé "],
			},
			{ mode: "replace" },
		);

		const summary = await commitDataset(
			[rec({ id: "b" })],
			1,
			{
				duplicateCount: 5,
				droppedCount: 1,
				prefixesSeen: ["Watched ", "Vous avez regardé "],
			},
			{ mode: "add" },
		);

		expect(summary.duplicateCount).toBe(7);
		expect(summary.droppedCount).toBe(4);
		// Union, deduped, first-seen order preserved.
		expect(summary.prefixesSeen).toEqual(["Vous avez regardé ", "Watched "]);
	});

	it("upserts playlist likes found in the same drop", async () => {
		const liked = (id: string): LikedTrack => ({
			id,
			videoId: id,
			title: `Track ${id}`,
			channel: null,
			addedAt: null,
			sourceFile: "liked-music.csv",
		});

		const first = await commitDataset([rec({ id: "a" })], 1, stats, {
			mode: "replace",
			likes: [liked("v1"), liked("v2")],
		});
		expect(first.likesWritten).toBe(2);
		expect(first.likesTotal).toBe(2);

		const second = await commitDataset([rec({ id: "b" })], 1, stats, {
			mode: "add",
			likes: [liked("v2"), liked("v3")],
		});
		expect(second.likesTotal).toBe(3);
		expect(await db.likes.count()).toBe(3);
	});

	it("adds nothing but likes when the history file yields no rows", async () => {
		await commitDataset([rec({ id: "keep" })], 1, stats, { mode: "replace" });
		const summary = await commitDataset([], 0, stats, {
			mode: "add",
			likes: [
				{
					id: "v1",
					videoId: "v1",
					title: "Track",
					channel: null,
					addedAt: null,
					sourceFile: "liked-music.csv",
				},
			],
		});

		expect(summary.rowCount).toBe(1);
		expect(summary.insertedCount).toBe(0);
		expect(summary.likesTotal).toBe(1);
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
