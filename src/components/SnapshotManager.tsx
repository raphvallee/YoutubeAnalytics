import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { useDatasetStore } from "@/state/dataset";
import { useSnapshotsStore } from "@/state/snapshots";

/**
 * Named snapshots of the current dataset (Phase 6 compare). The live dataset
 * is replaced on import; a snapshot freezes one copy to compare against.
 */
export function SnapshotManager() {
	const records = useDatasetStore((s) => s.records);
	const { list, reload, save, remove } = useSnapshotsStore();
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		reload();
	}, [reload]);

	const onSave = async () => {
		if (records.length === 0) return;
		setBusy(true);
		try {
			await save(name.trim() || defaultName(), records);
			setName("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="rounded-lg border p-4">
			<h2 className="mb-2 font-medium">Snapshots (compare)</h2>
			<p className="mb-3 text-sm text-muted-foreground">
				Freeze the current dataset under a name to overlay it on the Music page
				after a new import.
			</p>
			<div className="flex gap-2">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder={defaultName()}
					aria-label="Snapshot name"
					className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
				/>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || records.length === 0}
					onClick={() => void onSave()}
				>
					Save snapshot
				</Button>
			</div>
			{list.length > 0 && (
				<ul className="mt-3 space-y-1">
					{list.map((s) => (
						<li
							key={s.id}
							className="flex items-center justify-between gap-2 text-sm"
						>
							<span className="min-w-0 truncate">
								{s.name}{" "}
								<span className="text-muted-foreground">
									· {s.rowCount.toLocaleString()} rows ·{" "}
									{formatDateTime(s.createdAt)}
								</span>
							</span>
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground hover:text-foreground"
								onClick={() => void remove(s.id)}
							>
								Delete
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function defaultName(): string {
	return `Snapshot ${formatDateTime(Date.now())}`;
}
