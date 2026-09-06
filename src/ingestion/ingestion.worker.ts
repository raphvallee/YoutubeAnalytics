/// <reference lib="webworker" />
/**
 * Ingestion worker - docs/BLUEPRINT.md §1.2.
 * parse → normalize → dedupe → persist. Never touches the UI thread.
 * Dexie runs here too: IndexedDB is available in dedicated workers.
 */

import { type IngestSummary, replaceDataset } from "@/db/db";
import type { RawTakeoutEntry } from "./normalize";
import { type NormalizeStats, normalizeBatch } from "./normalize";

export type IngestRequest = { type: "ingest"; files: File[] };

export type IngestResponse =
	| {
			type: "progress";
			phase: "read" | "normalize" | "persist";
			fileIndex: number;
			fileCount: number;
			rows?: number;
	  }
	| { type: "done"; summary: IngestSummary }
	| { type: "error"; file: string; message: string };

function post(msg: IngestResponse) {
	self.postMessage(msg);
}

self.onmessage = async (event: MessageEvent<IngestRequest>) => {
	if (event.data.type !== "ingest") return;
	const files = event.data.files;
	if (files.length === 0) return;

	const existingIds = new Set<string>();
	const stats: NormalizeStats = {
		prefixesSeen: [],
		droppedCount: 0,
		droppedSearch: 0,
		droppedBadTime: 0,
	};
	let allRecords: Awaited<ReturnType<typeof normalizeBatch>> = [];
	let totalEntries = 0;

	try {
		for (const [fileIndex, file] of files.entries()) {
			post({
				type: "progress",
				phase: "read",
				fileIndex,
				fileCount: files.length,
			});
			const text = await file.text();

			post({
				type: "progress",
				phase: "normalize",
				fileIndex,
				fileCount: files.length,
			});
			let entries: RawTakeoutEntry[];
			try {
				const parsed: unknown = JSON.parse(text);
				if (!Array.isArray(parsed)) {
					post({
						type: "error",
						file: file.name,
						message: "Not a Takeout history: expected a JSON array of entries.",
					});
					return;
				}
				entries = parsed as RawTakeoutEntry[];
			} catch {
				post({ type: "error", file: file.name, message: "Invalid JSON." });
				return;
			}

			totalEntries += entries.length;
			const kept = await normalizeBatch(entries, existingIds, stats);
			allRecords = allRecords.concat(kept);
			post({
				type: "progress",
				phase: "normalize",
				fileIndex,
				fileCount: files.length,
				rows: kept.length,
			});
		}

		const duplicateCount =
			totalEntries - allRecords.length - stats.droppedCount;

		post({
			type: "progress",
			phase: "persist",
			fileIndex: files.length,
			fileCount: files.length,
		});
		const summary = await replaceDataset(allRecords, files.length, {
			duplicateCount,
			droppedCount: stats.droppedCount,
			prefixesSeen: stats.prefixesSeen,
		});
		post({ type: "done", summary });
	} catch (err) {
		post({
			type: "error",
			file: "(pipeline)",
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
