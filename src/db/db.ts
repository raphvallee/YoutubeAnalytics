import Dexie, { type EntityTable } from "dexie";
import {
	type ArtistOrigin,
	DATASET_SCHEMA_VERSION,
	type DatasetMeta,
	type DatasetSnapshot,
	type LikedTrack,
	type SnapshotData,
	type StreamRecord,
} from "./types";

/**
 * Persistence layer - docs/BLUEPRINT.md §2.2.
 *
 * Import semantics (BLUEPRINT §2.7): one rw transaction writes the whole run.
 * `replace` clears and rewrites; `add` upserts by row id so exports taken
 * months apart can be layered without losing earlier history. A snapshot is
 * always re-importable.
 */
class AnalyticsDB extends Dexie {
	streams!: EntityTable<StreamRecord, "id">;
	meta!: EntityTable<DatasetMeta, "key">;
	likes!: EntityTable<LikedTrack, "id">;
	snapshots!: EntityTable<DatasetSnapshot, "id">;
	snapshotData!: EntityTable<SnapshotData, "id">;
	artistOrigins!: EntityTable<ArtistOrigin, "artistKey">;

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
		// Phase 6: snapshot compare + release cache. Meta and the
		// record blob are split so listing snapshots never loads full datasets.
		this.version(3).stores({
			streams: "id, ts, kind, artistKey, videoId, [kind+ts], [artistKey+ts]",
			meta: "key",
			likes: "id, videoId, artistKey",
			snapshots: "id, createdAt",
			snapshotData: "id",
		});
		// Phase 7: artist-origin cache. Keyed by artistKey and deliberately
		// outside clearDataset() - external lookups are expensive, so a
		// re-import must reuse them until the browser data is cleared.
		this.version(4).stores({
			streams: "id, ts, kind, artistKey, videoId, [kind+ts], [artistKey+ts]",
			meta: "key",
			likes: "id, videoId, artistKey",
			snapshots: "id, createdAt",
			snapshotData: "id",
			artistOrigins: "artistKey",
		});
	}
}

export const db = new AnalyticsDB();

/** Per-run ingest numbers (not stored on their own - folded into meta). */
export interface IngestStats {
	duplicateCount: number;
	droppedCount: number;
	prefixesSeen: string[];
}

/** What an import actually did, for the post-import report. */
export interface IngestSummary extends DatasetMeta {
	/** Rows in `records` that already existed in the dataset (same id). */
	overlapCount: number;
	/** Rows that were not previously present: `records.length - overlapCount`. */
	insertedCount: number;
	/** true when the previous dataset was discarded. */
	replaced: boolean;
	/** Likes rows written by this run (playlist files routed from the drop). */
	likesWritten: number;
	/** Likes rows in the store after this run. */
	likesTotal: number;
}

interface Accumulator {
	rowCount: number;
	musicCount: number;
	youtubeCount: number;
	unattributedMusic: number;
	minTs: number;
	maxTs: number;
}

function emptyAccumulator(): Accumulator {
	return {
		rowCount: 0,
		musicCount: 0,
		youtubeCount: 0,
		unattributedMusic: 0,
		minTs: Number.POSITIVE_INFINITY,
		maxTs: Number.NEGATIVE_INFINITY,
	};
}

function accumulate(acc: Accumulator, r: StreamRecord): void {
	acc.rowCount++;
	if (r.kind === "music") {
		acc.musicCount += 1;
		if (!r.artist) acc.unattributedMusic += 1;
	} else {
		acc.youtubeCount++;
	}
	if (r.ts < acc.minTs) acc.minTs = r.ts;
	if (r.ts > acc.maxTs) acc.maxTs = r.ts;
}

/** Turn a pass over the rows into the meta counters. */
function toMeta(acc: Accumulator): DatasetMeta {
	return {
		key: "dataset",
		schemaVersion: DATASET_SCHEMA_VERSION,
		importedAt: Date.now(),
		fileCount: 0, // the caller owns provenance
		rowCount: acc.rowCount,
		musicCount: acc.musicCount,
		youtubeCount: acc.youtubeCount,
		unattributedMusic: acc.unattributedMusic,
		minTs: acc.rowCount ? acc.minTs : 0,
		maxTs: acc.rowCount ? acc.maxTs : 0,
		droppedCount: 0,
		duplicateCount: 0,
		prefixesSeen: [],
	};
}

function aggregate(records: Iterable<StreamRecord>): DatasetMeta {
	const acc = emptyAccumulator();
	for (const r of records) accumulate(acc, r);
	return toMeta(acc);
}

function unionPrefixes(
	a: readonly string[] | undefined,
	b: readonly string[],
): string[] {
	const out = [...(a ?? [])];
	for (const p of b) if (!out.includes(p)) out.push(p);
	return out;
}

export interface CommitOptions {
	/**
	 * "replace" clears the dataset first. "add" keeps it and upserts by row id,
	 * so a newer export corrects rows we already hold (Takeout rewrites a play's
	 * title and ad flags in place, and the id is time+videoId, so the id is
	 * stable while the payload is not).
	 */
	mode: "replace" | "add";
	/** Playlist rows discovered in the same drop, upserted by id. */
	likes?: LikedTrack[];
}

/**
 * Write an ingest run to the database in a single rw transaction: clear (if
 * replacing), bulkPut streams in 5k chunks, upsert likes, recompute the meta
 * counters, write meta. Either the whole run lands or none of it does.
 *
 * In "add" mode the aggregates are recomputed from the merged table rather than
 * delta-ed onto the stored ones: `minTs`/`maxTs` can only widen by reading the
 * table anyway, and deriving all of them the same way keeps them from drifting
 * apart. Costs one cursor pass, which is far cheaper than a wrong dashboard.
 */
export async function commitDataset(
	records: StreamRecord[],
	fileCount: number,
	stats: IngestStats,
	options: CommitOptions,
): Promise<IngestSummary> {
	const { mode } = options;
	const likes = options.likes ?? [];

	return db.transaction("rw", db.streams, db.meta, db.likes, async () => {
		const before = mode === "add" ? await getDatasetMeta() : undefined;

		// Count the overlap so the report can say how much of the file was
		// genuinely new. Cheap next to the parse that produced `records`.
		let overlapCount = 0;
		if (mode === "add" && records.length > 0) {
			const existing = new Set(await db.streams.toCollection().primaryKeys());
			for (const r of records) if (existing.has(r.id)) overlapCount++;
		}

		if (mode === "replace") await db.streams.clear();

		for (let i = 0; i < records.length; i += 5000) {
			await db.streams.bulkPut(records.slice(i, i + 5000));
		}

		if (likes.length > 0) {
			for (let i = 0; i < likes.length; i += 5000) {
				await db.likes.bulkPut(likes.slice(i, i + 5000));
			}
		}

		// Replace mode: the table now holds exactly `records`, so aggregate them
		// in memory. Add mode: re-derive from the merged table with a cursor
		// pass, so a 1M-row dataset is never materialized into memory.
		let meta: DatasetMeta;
		if (mode === "add") {
			const acc = emptyAccumulator();
			await db.streams.each((r) => {
				accumulate(acc, r);
			});
			meta = toMeta(acc);
		} else {
			meta = aggregate(records);
		}
		meta.importedAt = Date.now();
		meta.fileCount = before ? before.fileCount + fileCount : fileCount;
		meta.droppedCount = stats.droppedCount + (before?.droppedCount ?? 0);
		meta.duplicateCount = stats.duplicateCount + (before?.duplicateCount ?? 0);
		meta.prefixesSeen = unionPrefixes(before?.prefixesSeen, stats.prefixesSeen);
		await db.meta.put(meta);

		return {
			...meta,
			overlapCount,
			insertedCount: records.length - overlapCount,
			replaced: mode === "replace",
			likesWritten: likes.length,
			likesTotal: await db.likes.count(),
		};
	});
}

/**
 * Replace the dataset with the given records and write fresh meta.
 * Thin wrapper over {@link commitDataset} - kept for the single-file callers
 * that have always meant "this file is the dataset".
 */
export async function replaceDataset(
	records: StreamRecord[],
	fileCount: number,
	stats: IngestStats,
): Promise<IngestSummary> {
	return commitDataset(records, fileCount, stats, { mode: "replace" });
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

/** Save the current in-memory dataset as a named snapshot (Phase 6 compare). */
export async function saveSnapshot(
	name: string,
	records: StreamRecord[],
): Promise<DatasetSnapshot> {
	const meta: DatasetSnapshot = {
		id: crypto.randomUUID(),
		name,
		createdAt: Date.now(),
		rowCount: records.length,
	};
	await db.transaction("rw", db.snapshots, db.snapshotData, async () => {
		await db.snapshots.put(meta);
		await db.snapshotData.put({ id: meta.id, records });
	});
	return meta;
}

export async function listSnapshots(): Promise<DatasetSnapshot[]> {
	return db.snapshots.orderBy("createdAt").reverse().toArray();
}

export async function loadSnapshotRecords(
	id: string,
): Promise<StreamRecord[] | null> {
	const row = await db.snapshotData.get(id);
	return row?.records ?? null;
}

export async function deleteSnapshot(id: string): Promise<void> {
	await db.transaction("rw", db.snapshots, db.snapshotData, async () => {
		await db.snapshots.delete(id);
		await db.snapshotData.delete(id);
	});
}

/** Cache artist-origin lookups (one row per artistKey - Phase 7). */
export async function putArtistOrigins(origins: ArtistOrigin[]): Promise<void> {
	await db.artistOrigins.bulkPut(origins);
}

export async function allArtistOrigins(): Promise<ArtistOrigin[]> {
	return db.artistOrigins.toArray();
}

export async function clearArtistOrigins(): Promise<void> {
	await db.artistOrigins.clear();
}
