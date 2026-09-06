/**
 * Main-thread client for the ingestion worker.
 * One worker per import run, terminated on completion.
 */

import type { IngestSummary } from "@/db/db";
import type { IngestRequest, IngestResponse } from "./ingestion.worker";

export interface IngestProgress {
	phase: "read" | "normalize" | "persist";
	fileIndex: number;
	fileCount: number;
	rows?: number;
}

export interface IngestHandlers {
	onProgress?: (p: IngestProgress) => void;
	onFileError?: (file: string, message: string) => void;
}

export function ingestFiles(
	files: File[],
	handlers: IngestHandlers = {},
): Promise<IngestSummary> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(
			new URL("./ingestion.worker.ts", import.meta.url),
			{
				type: "module",
			},
		);

		const finish = (fn: () => void) => {
			worker.terminate();
			fn();
		};

		worker.onmessage = (event: MessageEvent<IngestResponse>) => {
			const msg = event.data;
			if (msg.type === "progress") {
				handlers.onProgress?.(msg);
			} else if (msg.type === "done") {
				finish(() => resolve(msg.summary));
			} else {
				handlers.onFileError?.(msg.file, msg.message);
				finish(() => reject(new Error(`${msg.file}: ${msg.message}`)));
			}
		};

		worker.onerror = (event) => {
			finish(() => reject(new Error(event.message || "Worker crashed")));
		};

		const request: IngestRequest = { type: "ingest", files };
		worker.postMessage(request);
	});
}
