import { create } from "zustand";
import {
	deleteSnapshot,
	listSnapshots,
	loadSnapshotRecords,
	saveSnapshot,
} from "@/db/db";
import type { DatasetSnapshot, StreamRecord } from "@/db/types";

interface SnapshotsState {
	list: DatasetSnapshot[];
	/** Snapshot selected for compare (null = compare off). */
	active: DatasetSnapshot | null;
	records: StreamRecord[];
	loading: boolean;
	reload: () => void;
	/** Select a snapshot for compare (null clears). */
	select: (id: string | null) => Promise<void>;
	save: (name: string, records: StreamRecord[]) => Promise<void>;
	remove: (id: string) => Promise<void>;
}

let seq = 0;

export const useSnapshotsStore = create<SnapshotsState>((set, get) => ({
	list: [],
	active: null,
	records: [],
	loading: false,
	reload: () => {
		const my = ++seq;
		void listSnapshots().then((list) => {
			if (my !== seq) return;
			// Drop an active selection that no longer exists.
			const active =
				get().active && list.some((s) => s.id === get().active?.id)
					? get().active
					: null;
			set({ list, active, records: active ? get().records : [] });
		});
	},
	select: async (id) => {
		if (id === null) {
			set({ active: null, records: [] });
			return;
		}
		const meta = get().list.find((s) => s.id === id);
		if (!meta) return;
		set({ loading: true });
		const records = (await loadSnapshotRecords(id)) ?? [];
		set({ active: meta, records, loading: false });
	},
	save: async (name, records) => {
		await saveSnapshot(name, records);
		set({ list: await listSnapshots() });
	},
	remove: async (id) => {
		await deleteSnapshot(id);
		const list = await listSnapshots();
		const active = get().active?.id === id ? null : get().active;
		set({ list, active, records: active ? get().records : [] });
	},
}));
