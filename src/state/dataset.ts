import { create } from "zustand";
import { invalidateAnalytics } from "@/analytics/analyticsClient";
import { getDatasetMeta, loadAllStreams } from "@/db/db";
import type { DatasetMeta, StreamRecord } from "@/db/types";
import { resetSeriesColors } from "@/lib/palette";

interface DatasetState {
	status: "idle" | "loading" | "ready";
	records: StreamRecord[];
	meta: DatasetMeta | null;
	/** Bump to re-run load() after import/clear. Resolves when data is ready. */
	reload: () => Promise<void>;
}

let loadSeq = 0;

/**
 * Dataset store (BLUEPRINT §1.2): one IndexedDB read on start/refresh, kept in
 * memory because the World Map's origins ranking and the Import page's snapshot
 * buttons need the rows themselves.
 *
 * What changed in Phase 9: the aggregation passes do NOT run over `records`
 * here any more - they run in the analytics worker, which reads the same tables
 * itself. So a page mount no longer costs a 200ms render, and `reload()` only
 * has to tell the worker to re-read rather than re-serialize 120k rows across a
 * worker boundary.
 */
export const useDatasetStore = create<DatasetState>((set) => ({
	status: "idle",
	records: [],
	meta: null,
	reload: () => {
		const seq = ++loadSeq;
		set({ status: "loading" });
		return Promise.all([loadAllStreams(), getDatasetMeta()]).then(
			([records, meta]) => {
				if (seq !== loadSeq) return; // a newer reload superseded this one
				resetSeriesColors(); // colors follow entities; new dataset invalidates registry
				// The analytics worker caches its own copy and its own track-key
				// memo; this is the signal that both are now stale.
				invalidateAnalytics();
				set({ status: "ready", records, meta });
			},
		);
	},
}));
