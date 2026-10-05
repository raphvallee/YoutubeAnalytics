/**
 * Main-thread client for the ingestion worker.
 * One worker per request, terminated on completion.
 */

import type { CommitOptions, IngestSummary } from "@/db/db";
import type { FileVerdict } from "./detect";
import type {
	IngestPhase,
	IngestRequest,
	IngestResponse,
} from "./ingestion.worker";

export interface IngestProgress {
	phase: IngestPhase;
	/**
	 * 0-based position of the file currently being handled, or null when the
	 * phase is not about a single file (persisting). A null index is what keeps
	 * the UI from printing a position one past the end of the batch.
	 */
	fileIndex: number | null;
	fileCount: number;
	/**
	 * Rows in flight, and what it counts depends on the phase: for "normalize"
	 * the rows kept from the file being parsed, for "persist" the whole batch
	 * about to be written.
	 */
	rows?: number;
}

export interface IngestResult {
	summary: IngestSummary;
	verdicts: FileVerdict[];
}

function newWorker(): Worker {
	return new Worker(new URL("./ingestion.worker.ts", import.meta.url), {
		type: "module",
	});
}

function onMessage<T>(
	worker: Worker,
	resolve: (value: T) => void,
	reject: (err: Error) => void,
	handlers: { onProgress?: (p: IngestProgress) => void },
	select: (msg: IngestResponse) => T | null,
) {
	return (event: MessageEvent<IngestResponse>) => {
		const msg = event.data;
		if (msg.type === "progress") {
			handlers.onProgress?.(msg);
			return;
		}
		if (msg.type === "error") {
			worker.terminate();
			reject(new Error(msg.message));
			return;
		}
		const value = select(msg);
		if (value !== null) {
			worker.terminate();
			resolve(value);
		}
	};
}

/**
 * Decide what each file is, without importing anything.
 * Runs against the head of each file, so it is safe to call on a large drop.
 */
export function classifyFiles(
	files: File[],
	handlers: { onProgress?: (p: IngestProgress) => void } = {},
): Promise<FileVerdict[]> {
	return new Promise((resolve, reject) => {
		const worker = newWorker();
		worker.onmessage = onMessage(worker, resolve, reject, handlers, (msg) =>
			msg.type === "verdicts" ? msg.verdicts : null,
		);
		worker.onerror = (event) => {
			worker.terminate();
			reject(new Error(event.message || "Worker crashed"));
		};
		const request: IngestRequest = { type: "classify", files };
		worker.postMessage(request);
	});
}

/** Parse, normalize and commit the given files in one transaction. */
export function ingestFiles(
	files: File[],
	options: CommitOptions,
	handlers: { onProgress?: (p: IngestProgress) => void } = {},
): Promise<IngestResult> {
	return new Promise((resolve, reject) => {
		const worker = newWorker();
		worker.onmessage = onMessage(worker, resolve, reject, handlers, (msg) =>
			msg.type === "done"
				? { summary: msg.summary, verdicts: msg.verdicts }
				: null,
		);
		worker.onerror = (event) => {
			worker.terminate();
			reject(new Error(event.message || "Worker crashed"));
		};
		const request: IngestRequest = { type: "ingest", files, options };
		worker.postMessage(request);
	});
}
