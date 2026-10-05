/// <reference lib="webworker" />
/**
 * Ingestion worker - docs/BLUEPRINT.md §1.2.
 * parse → normalize → dedupe → persist. Never touches the UI thread.
 * Dexie runs here too: IndexedDB is available in dedicated workers.
 *
 * Files are routed by content (see `./detect.ts`), never by filename: a
 * Takeout folder holds `watch-history.json`, `search-history.json`,
 * `subscriptions.json` and `playlists/liked-music.csv` side by side, and users
 * rename the history parts themselves. Each file gets a verdict and the run
 * continues past the ones we cannot use, instead of aborting the whole drop on
 * the first bad file.
 */

import {
	type CommitOptions,
	commitDataset,
	type IngestStats,
	type IngestSummary,
} from "@/db/db";
import type { LikedTrack } from "@/db/types";
import { classifyTakeoutText, type FileVerdict, signatureOf } from "./detect";
import { parseLikesFile } from "./likesParse";
import {
	type NormalizeStats,
	normalizeBatch,
	type RawTakeoutEntry,
} from "./normalize";

export type IngestPhase = "read" | "normalize" | "persist";

export type IngestRequest =
	| { type: "ingest"; files: File[]; options: CommitOptions }
	| { type: "classify"; files: File[] };

export type IngestResponse =
	| {
			type: "progress";
			phase: IngestPhase;
			/** 0-based, or null when the phase is not about a single file. */
			fileIndex: number | null;
			fileCount: number;
			rows?: number;
	  }
	| { type: "verdicts"; verdicts: FileVerdict[] }
	| { type: "done"; summary: IngestSummary; verdicts: FileVerdict[] }
	| { type: "error"; message: string };

/** How many bytes of a file we read to decide what it is. */
const HEAD_BYTES = 512 * 1024;

function post(msg: IngestResponse) {
	self.postMessage(msg);
}

const headOf = (file: File): Promise<string> =>
	file.size <= HEAD_BYTES ? file.text() : file.slice(0, HEAD_BYTES).text();

/** Read the head of a file and classify it. */
async function classify(
	file: File,
	index: number,
	count: number,
): Promise<FileVerdict> {
	post({ type: "progress", phase: "read", fileIndex: index, fileCount: count });
	const [head, signature] = await Promise.all([
		headOf(file),
		signatureOf(file),
	]);
	return classifyTakeoutText(head, file.name, file.size, signature);
}

/** Only read the whole file once we know it is one of ours. */
function readWhole(file: File): Promise<string> {
	return file.text();
}

self.onmessage = async (event: MessageEvent<IngestRequest>) => {
	const req = event.data;

	if (req.type === "classify") {
		const files = req.files;
		try {
			const verdicts: FileVerdict[] = [];
			for (const [i, file] of files.entries()) {
				verdicts.push(await classify(file, i, files.length));
			}
			post({ type: "verdicts", verdicts });
		} catch (err) {
			post({
				type: "error",
				message: err instanceof Error ? err.message : String(err),
			});
		}
		return;
	}

	if (req.type !== "ingest") return;
	const { files, options } = req;
	if (files.length === 0) return;

	const existingIds = new Set<string>();
	const stats: NormalizeStats = {
		prefixesSeen: [],
		droppedCount: 0,
		droppedSearch: 0,
		droppedBadTime: 0,
	};
	const verdicts: FileVerdict[] = [];
	const likes: LikedTrack[] = [];
	let allRecords: Awaited<ReturnType<typeof normalizeBatch>> = [];
	let totalEntries = 0;

	try {
		for (const [fileIndex, file] of files.entries()) {
			const verdict = await classify(file, fileIndex, files.length);

			if (verdict.role === "unknown") {
				verdicts.push(verdict);
				continue;
			}

			if (verdict.role === "playlist") {
				const parsed = parseLikesFile(await readWhole(file), file.name);
				if (parsed.length === 0) {
					verdicts.push({
						...verdict,
						role: "unknown",
						reason: "No recognizable playlist rows - skipped.",
					});
					continue;
				}
				likes.push(...parsed);
				verdicts.push({
					...verdict,
					reason: `Playlist - ${parsed.length.toLocaleString()} liked tracks found.`,
				});
				continue;
			}

			post({
				type: "progress",
				phase: "normalize",
				fileIndex,
				fileCount: files.length,
			});
			let entries: RawTakeoutEntry[];
			try {
				const parsed: unknown = JSON.parse(await readWhole(file));
				if (!Array.isArray(parsed)) {
					throw new Error("expected a JSON array of entries");
				}
				entries = parsed as RawTakeoutEntry[];
			} catch (err) {
				verdicts.push({
					...verdict,
					role: "unknown",
					reason: `Could not be parsed (${err instanceof Error ? err.message : String(err)}) - skipped.`,
				});
				continue;
			}

			totalEntries += entries.length;
			const kept = await normalizeBatch(entries, existingIds, stats);
			allRecords = allRecords.concat(kept);
			verdicts.push({
				...verdict,
				reason: `Watch history - ${kept.length.toLocaleString()} of ${entries.length.toLocaleString()} rows kept.`,
			});
			post({
				type: "progress",
				phase: "normalize",
				fileIndex,
				fileCount: files.length,
				rows: kept.length,
			});
		}

		// Refuse before touching the database: an empty result is always a
		// mistake (wrong file, or a history whose rows all failed validation),
		// and under "replace" it would silently wipe the dataset.
		if (
			allRecords.length === 0 &&
			(options.mode === "replace" || likes.length === 0)
		) {
			const skipped = verdicts
				.filter((v) => v.role === "unknown")
				.map((v) => `${v.name}: ${v.reason}`);
			throw new Error(
				skipped.length > 0
					? `No watch-history rows found. Nothing was imported.\n${skipped.join("\n")}`
					: "No watch-history rows found. Nothing was imported.",
			);
		}

		const ingestStats: IngestStats = {
			duplicateCount: totalEntries - allRecords.length - stats.droppedCount,
			droppedCount: stats.droppedCount,
			prefixesSeen: stats.prefixesSeen,
		};
		// Provenance counts what we actually read, not what was dropped on the
		// zone: "3 files imported" must not include the search history we skipped.
		const usedCount = verdicts.filter((v) => v.role !== "unknown").length;

		// No file is in flight any more - the whole batch is written as one
		// transaction - so the index is null rather than one past the last file,
		// and `rows` carries the only number that means anything here.
		post({
			type: "progress",
			phase: "persist",
			fileIndex: null,
			fileCount: files.length,
			rows: allRecords.length,
		});
		const summary = await commitDataset(allRecords, usedCount, ingestStats, {
			...options,
			likes,
		});
		post({ type: "done", summary, verdicts });
	} catch (err) {
		post({
			type: "error",
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
