import Dexie, { type EntityTable } from "dexie";
import {
	DATASET_SCHEMA_VERSION,
	type DatasetMeta,
	type LikedTrack,
	type StreamRecord,
} from "./types";

/**
 * Persistence layer — docs/BLUEPRINT.md §2.2.
 *
 * Import semantics: replace the whole dataset (clear + bulkPut in one rw
 * transaction). A snapshot is re-importable, incremental merge is a later
 * Settings feature.
 */
class AnalyticsDB extends Dexie {
	streams!: EntityTable<StreamRecord, "id">;
	meta!: EntityTable<DatasetMeta, "key">;
	likes!: EntityTable<LikedTrack, "id">;

	constructor() {
		super("youtube-analytics");
		this.version(DATASET_SCHEMA_VERSION).stores({
			// Compound indexes: [kind+ts] for per-domain time ranges,
			// [artistKey+ts] for per-artist affinity queries (Phase 3).
			streams: "id, ts, kind, artistKey, videoId, [kind+ts], [artistKey+ts]",
			meta: "key",
		});
		// Likes live independently of the watch-history dataset (Phase 5).
		this.version(2).stores({
			streams: "id, ts, kind, artistKey, videoId, [kind+ts], [artistKey+ts]",
			meta: "key",
			likes: "id, videoId, artistKey",
		});
	}
}

export const db = new AnalyticsDB();

export interface IngestSummary extends DatasetMeta {
	duplicatesAcrossBatches: number;
}

/** Replace the dataset with the given records and write fresh meta. */
export async function replaceDataset(
	records: StreamRecord[],
	fileCount: number,
	stats: {
		duplicateCount: number;
		droppedCount: number;
		prefixesSeen: string[];
	},
): Promise<IngestSummary> {
	const now = Date.now();
	let musicCount = 0;
	let youtubeCount = 0;
	let unattributedMusic = 0;
	let minTs = Number.POSITIVE_INFINITY;
	let maxTs = Number.NEGATIVE_INFINITY;

	for (const r of records) {
		if (r.kind === "music") {
			musicCount += 1;
			if (!r.artist) unattributedMusic += 1;
		} else {
			youtubeCount += 1;
		}
		if (r.ts < minTs) minTs = r.ts;
		if (r.ts > maxTs) maxTs = r.ts;
	}

	const meta: DatasetMeta = {
		key: "dataset",
		schemaVersion: DATASET_SCHEMA_VERSION,
		importedAt: now,
		fileCount,
		rowCount: records.length,
		musicCount,
		youtubeCount,
		droppedCount: stats.droppedCount,
		duplicateCount: stats.duplicateCount,
		unattributedMusic,
		minTs: records.length ? minTs : 0,
		maxTs: records.length ? maxTs : 0,
		prefixesSeen: stats.prefixesSeen,
	};

	await db.transaction("rw", db.streams, db.meta, async () => {
		await db.streams.clear();
		for (let i = 0; i < records.length; i += 5000) {
			await db.streams.bulkPut(records.slice(i, i + 5000));
		}
		await db.meta.put(meta);
	});

	return { ...meta, duplicatesAcrossBatches: stats.duplicateCount };
}

export async function getDatasetMeta(): Promise<DatasetMeta | undefined> {
	return db.meta.get("dataset");
}

export async function loadAllStreams(): Promise<StreamRecord[]> {
	return db.streams.toArray();
}

export async function clearDataset(): Promise<void> {
	await db.transaction("rw", db.streams, db.meta, async () => {
		await db.streams.clear();
		await db.meta.clear();
	});
}

/** Replace the likes dataset (likes are independent of watch history). */
export async function replaceLikes(likes: LikedTrack[]): Promise<number> {
	await db.transaction("rw", db.likes, async () => {
		await db.likes.clear();
		for (let i = 0; i < likes.length; i += 5000) {
			await db.likes.bulkPut(likes.slice(i, i + 5000));
		}
	});
	return likes.length;
}

export async function loadAllLikes(): Promise<LikedTrack[]> {
	return db.likes.toArray();
}

export async function likesCount(): Promise<number> {
	return db.likes.count();
}

export async function clearLikes(): Promise<void> {
	await db.likes.clear();
}
