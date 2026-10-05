/**
 * Copy for the import progress line - docs/BLUEPRINT.md §1.2.
 *
 * Lives next to the worker that produces {@link IngestProgress} rather than in
 * the view, because the one rule that matters is a contract with the worker: a
 * file position is only printed when a file is actually in flight. The persist
 * phase writes the whole batch in one transaction, so it has no file to point
 * at and reports the row count instead.
 */

import type { IngestProgress } from "./ingestClient";
import type { IngestPhase } from "./ingestion.worker";

const PHASE_LABEL: Record<IngestPhase, string> = {
	read: "Reading file",
	normalize: "Parsing & normalizing",
	persist: "Writing to local database",
};

export interface ProgressText {
	/** The headline, e.g. `Parsing & normalizing… (file 2 of 3)`. */
	title: string;
	/** The supporting number, or null when the phase has none yet. */
	detail: string | null;
}

/**
 * Turn one progress event into what the dropzone shows. `fileIndex` is
 * 0-based, so it is only ever rendered as `index + 1`, and never at all when
 * it is null.
 */
export function progressText(progress: IngestProgress): ProgressText {
	const label = PHASE_LABEL[progress.phase];
	const rows =
		typeof progress.rows === "number" ? progress.rows.toLocaleString() : null;

	if (progress.fileIndex === null) {
		return {
			title: `${label}…`,
			detail: rows === null ? null : `${rows} streams to write`,
		};
	}

	return {
		title: `${label}… (file ${progress.fileIndex + 1} of ${progress.fileCount})`,
		detail: rows === null ? null : `${rows} streams from this file`,
	};
}
