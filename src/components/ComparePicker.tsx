import { useSnapshotsStore } from "@/state/snapshots";

/** Snapshot selector for the Music page compare mode (Phase 6). */
export function ComparePicker() {
	const { list, active, select, loading } = useSnapshotsStore();

	if (list.length === 0) return null;

	return (
		<div className="flex items-center gap-2 text-sm">
			<label htmlFor="compare-snapshot" className="text-muted-foreground">
				Compare with snapshot
			</label>
			<select
				id="compare-snapshot"
				value={active?.id ?? ""}
				disabled={loading}
				onChange={(e) => void select(e.target.value || null)}
				className="rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
			>
				<option value="">Off</option>
				{list.map((s) => (
					<option key={s.id} value={s.id}>
						{s.name} ({s.rowCount.toLocaleString()} rows)
					</option>
				))}
			</select>
		</div>
	);
}
