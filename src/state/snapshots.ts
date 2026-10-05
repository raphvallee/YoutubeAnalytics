import { create } from "zustand";
import { deleteSnapshot, listSnapshots, saveSnapshot } from "@/db/db";
import type { DatasetSnapshot, StreamRecord } from "@/db/types";

interface SnapshotsState {
	list: DatasetSnapshot[];
	/** Snapshot selected for compare (null = compare off). */
	active: DatasetSnapshot | null;
	reload: () => void;
	/** Select a snapshot for compare (null clears). */
	select: (id: string | null) => void;
	save: (name: string, records: StreamRecord[]) => Promise<void>;
	remove: (id: string) => Promise<void>;
}

let seq = 0;

/**
 * The compare snapshots' metadata.
 *
 * What changed in Phase 9: this store no longer holds the snapshot's rows.
 * Selecting a snapshot used to read its full record array onto the main thread
 * (up to a second copy of the dataset, deserialized there); the analytics worker
 * now loads the rows itself when it answers the compare request, so all this
 * store has to know is WHICH snapshot is selected.
 */
export const useSnapshotsStore = create<SnapshotsState>((set, get) => ({
	list: [],
	active: null,
	reload: () => {
		const my = ++seq;
		void listSnapshots().then((list) => {
			if (my !== seq) return;
			// Drop an active selection that no longer exists.
			const active =
				get().active && list.some((s) => s.id === get().active?.id)
					? get().active
					: null;
			set({ list, active });
		});
	},
	// Purely a selection now - the worker loads the rows behind the compare
	// request, so there is nothing to await here. The picker stays responsive
	// and the compare card shows its own loading state while numbers arrive.
	select: (id) => {
		if (id === null) {
			set({ active: null });
			return;
		}
		const meta = get().list.find((s) => s.id === id);
		if (!meta) return;
		set({ active: meta });
	},
	save: async (name, records) => {
		await saveSnapshot(name, records);
		set({ list: await listSnapshots() });
	},
	remove: async (id) => {
		await deleteSnapshot(id);
		const list = await listSnapshots();
		const active = get().active?.id === id ? null : get().active;
		set({ list, active });
	},
}));
