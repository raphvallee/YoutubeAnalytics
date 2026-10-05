import { Button } from "@/components/ui/button";
import { type FileVerdict, tallyVerdicts } from "@/ingestion/detect";
import { formatBytes } from "@/lib/storage";

export type ImportMode = "add" | "replace";

const ROLE_LABEL: Record<FileVerdict["role"], string> = {
	"watch-history": "History",
	playlist: "Playlist",
	unknown: "Skipped",
};

const ROLE_CLASS: Record<FileVerdict["role"], string> = {
	"watch-history": "border-primary/40 bg-primary/10 text-foreground",
	playlist: "border-border bg-accent/40 text-foreground",
	unknown: "border-destructive/40 bg-destructive/10 text-muted-foreground",
};

/**
 * One staged file. `verdict` is null while the file is still being read, so a
 * row can appear the instant it is dropped and fill in a moment later.
 */
export interface StagedFile {
	/** Stable identity (name + size + mtime), used as React key and for dedupe. */
	key: string;
	verdict: FileVerdict | null;
	/**
	 * Display name, disambiguated across the batch: a second `watch-history.json`
	 * with different contents shows as `watch-history-2.json`.
	 */
	label?: string;
}

export interface ImportReviewProps {
	files: StagedFile[];
	mode: ImportMode;
	onModeChange: (mode: ImportMode) => void;
	onRemove: (key: string) => void;
	/** null on a first import - there is nothing to add to or replace yet. */
	existing: { rowCount: number } | null;
	onConfirm: () => void;
	onCancel: () => void;
	busy: boolean;
	/**
	 * Something happened to the batch itself that is not an error: a dropped
	 * file turned out to be a byte-identical copy of one already staged, so it
	 * was dropped from the list. Rendered next to the list it explains, not
	 * below the fold where it would read as a failure of the import.
	 */
	notice?: string | null;
}

/**
 * Preflight: what we think each dropped file is, before anything is written.
 * The point is that "wrong file" and "will this wipe my data" are both
 * answered *before* the import, not after.
 *
 * The list accumulates across drops. Exports taken months apart all contain a
 * file called `watch-history.json` and sit in separate folders, so assembling
 * a batch means one drag per export; each row can be pulled back out.
 */
export function ImportReview({
	files,
	mode,
	onModeChange,
	onRemove,
	existing,
	onConfirm,
	onCancel,
	busy,
	notice,
}: ImportReviewProps) {
	const { histories, playlists, skipped } = tallyVerdicts(
		files.flatMap((f) => (f.verdict ? [f.verdict] : [])),
	);
	const checking = files.some((f) => f.verdict === null);
	const nothingUsable = !checking && histories === 0 && playlists === 0;

	return (
		<div className="rounded-lg border p-4">
			<div className="mb-1 flex items-baseline justify-between gap-4">
				<h2 className="font-medium">Ready to import</h2>
				<p className="text-sm text-muted-foreground">
					{checking
						? "Checking files…"
						: `${histories} history file${histories === 1 ? "" : "s"}` +
							(playlists > 0
								? `, ${playlists} playlist${playlists === 1 ? "" : "s"}`
								: "") +
							(skipped > 0 ? `, ${skipped} skipped` : "")}
				</p>
			</div>
			<p className="mb-3 text-xs text-muted-foreground">
				Drop more files to add them to this batch - the list does not reset.
			</p>

			<ul className="mb-4 divide-y rounded-md border text-sm">
				{files.map(({ key, verdict, label }) => {
					const shown = label ?? verdict?.name;
					return (
						<li key={key} className="flex items-start gap-3 px-3 py-2">
							<span
								className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] ${
									verdict === null
										? "border-border text-muted-foreground"
										: ROLE_CLASS[verdict.role]
								}`}
							>
								{verdict === null ? "Checking" : ROLE_LABEL[verdict.role]}
							</span>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium">{shown}</span>
								{label !== undefined && label !== verdict?.name && (
									<span className="block text-xs text-muted-foreground">
										on disk as {verdict?.name}
									</span>
								)}
								<span className="block text-muted-foreground">
									{verdict?.reason ?? "Reading the start of the file..."}
								</span>
							</span>
							<span className="shrink-0 font-mono text-xs text-muted-foreground">
								{verdict && formatBytes(verdict.size)}
							</span>
							<button
								type="button"
								aria-label={`Remove ${shown ?? "file"} from this batch`}
								disabled={busy}
								onClick={() => onRemove(key)}
								className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
							>
								&times;
							</button>
						</li>
					);
				})}
			</ul>

			{notice && (
				<p
					role="status"
					className="-mt-2 mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
				>
					{notice}
				</p>
			)}

			{existing && (
				<fieldset
					className="mb-3 flex overflow-hidden rounded-md border text-sm"
					aria-label="What to do with the data already imported"
				>
					<button
						type="button"
						disabled={busy}
						aria-pressed={mode === "add"}
						className={`flex-1 px-3 py-2 text-left disabled:opacity-60 ${
							mode === "add"
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-accent"
						}`}
						onClick={() => onModeChange("add")}
					>
						<span className="block font-medium">Add to imported data</span>
						<span
							className={`block text-xs ${mode === "add" ? "text-primary-foreground/80" : "text-muted-foreground"}`}
						>
							Keeps the {existing.rowCount.toLocaleString()} streams you already
							have
						</span>
					</button>
					<button
						type="button"
						disabled={busy}
						aria-pressed={mode === "replace"}
						className={`flex-1 border-l px-3 py-2 text-left disabled:opacity-60 ${
							mode === "replace"
								? "bg-destructive text-destructive-foreground"
								: "text-muted-foreground hover:bg-accent"
						}`}
						onClick={() => onModeChange("replace")}
					>
						<span className="block font-medium">Replace everything</span>
						<span
							className={`block text-xs ${mode === "replace" ? "text-destructive-foreground/80" : "text-muted-foreground"}`}
						>
							Discards the current dataset (a snapshot is saved first)
						</span>
					</button>
				</fieldset>
			)}

			{nothingUsable ? (
				<p className="text-sm text-muted-foreground">
					None of these files look like a Takeout export. Import is disabled so
					your current data stays untouched.
				</p>
			) : (
				<p className="mb-3 text-xs text-muted-foreground">
					{existing
						? mode === "add"
							? "Rows already in the database are matched by time + video id, so re-importing the same export changes nothing."
							: "The current dataset is discarded, but only after a snapshot is saved - you can restore it from Snapshots below."
						: "Nothing is imported yet, so this becomes your dataset."}
				</p>
			)}

			<div className="flex gap-2">
				<Button onClick={onConfirm} disabled={busy || nothingUsable}>
					Import
				</Button>
				<Button variant="secondary" onClick={onCancel} disabled={busy}>
					Cancel
				</Button>
			</div>
		</div>
	);
}
