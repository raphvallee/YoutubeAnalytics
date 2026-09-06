import { create } from "zustand";
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
 * Whole-dataset in-memory store (BLUEPRINT §1.2): one IndexedDB read on
 * start/refresh; aggregations run over `records` with useMemo downstream.
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
				set({ status: "ready", records, meta });
			},
		);
	},
}));
