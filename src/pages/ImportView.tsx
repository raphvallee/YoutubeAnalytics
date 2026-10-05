import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ImportMode,
	ImportReview,
	type StagedFile,
} from "@/components/ImportReview";
import { LikesUpload } from "@/components/LikesUpload";
import { OriginLookupCard } from "@/components/OriginLookupCard";
import { SnapshotManager } from "@/components/SnapshotManager";
import { Button } from "@/components/ui/button";
import { clearDataset, getDatasetMeta } from "@/db/db";
import type { DatasetMeta } from "@/db/types";
import { disambiguateNames } from "@/ingestion/detect";
import {
	classifyFiles,
	type IngestProgress,
	type IngestResult,
	ingestFiles,
} from "@/ingestion/ingestClient";
import { progressText } from "@/ingestion/progressText";
import {
	formatBytes,
	getStorageEstimate,
	isStoragePersisted,
	requestPersistentStorage,
} from "@/lib/storage";
import { useDatasetStore } from "@/state/dataset";
import { useLikesStore } from "@/state/likes";
import { useSnapshotsStore } from "@/state/snapshots";

const MODE_KEY = "import-mode";

/** Remembered so a user layering exports is not asked on every drop. */
function loadMode(): ImportMode {
	try {
		return localStorage.getItem(MODE_KEY) === "replace" ? "replace" : "add";
	} catch {
		return "add";
	}
}

function formatDate(ts: number): string {
	return ts ? new Date(ts).toLocaleString() : "-";
}

/**
 * Identity of a staged file. Name alone is not enough - every Takeout part is
 * called `watch-history.json`, and the whole point of the batch is several of
 * them - so size and mtime come along to tell two genuinely different files
 * apart while still collapsing a double-drop of the same one.
 */
function fileKey(file: File): string {
	return `${file.name}:${file.size}:${file.lastModified}`;
}

/** A file in the staging list, with its verdict once it has been read. */
interface StagedEntry extends StagedFile {
	file: File;
	/**
	 * Content fingerprint, known only after classification. It is what decides
	 * whether a second file of the same name is new data or the same bytes.
	 */
	signature: string | null;
	/** Display name, disambiguated across the batch (see `disambiguateNames`). */
	label: string;
}

/**
 * Recompute the disambiguated display names for a batch. Labels are a function
 * of the whole batch, so adding or removing a file renumbers the rest - which
 * is why this runs on every mutation rather than being stored per file.
 */
function relabel(entries: StagedEntry[]): StagedEntry[] {
	const labels = disambiguateNames(entries.map((e) => ({ name: e.file.name })));
	return entries.map((e, i) => ({ ...e, label: labels[i] ?? e.file.name }));
}

export default function ImportView() {
	const meta = useLiveQuery<DatasetMeta | undefined>(
		() => getDatasetMeta(),
		[],
	);
	const likesReload = useLikesStore((s) => s.reload);
	useEffect(() => {
		likesReload();
	}, [likesReload]);
	const inputRef = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const [importing, setImporting] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [progress, setProgress] = useState<IngestProgress | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Batch-level notes that are not failures (a duplicate was ignored). Kept
	// apart from `error` so it renders inside the preflight list, next to the
	// rows it explains, instead of in the page-level error banner.
	const [notice, setNotice] = useState<string | null>(null);
	const [staged, setStaged] = useState<StagedEntry[]>([]);
	// The batch lives in a ref as the source of truth and is mirrored into
	// state for rendering. `stageFiles` reads it from async callbacks and
	// must see the newest rows without re-subscribing on every change; writing
	// during render instead would break under StrictMode double-rendering.
	const stagedRef = useRef<StagedEntry[]>([]);
	const stagedKeys = useRef(new Set<string>());
	const commitStaged = useCallback((next: StagedEntry[]) => {
		stagedRef.current = next;
		setStaged(next);
	}, []);
	const [mode, setMode] = useState<ImportMode>(loadMode);
	const [result, setResult] = useState<IngestResult | null>(null);
	const [storage, setStorage] = useState<{
		persisted: boolean | null;
		usage: number;
		quota: number;
	} | null>(null);

	// Deliberately excludes staging: the batch stays open for more drops while
	// classification runs, and even mid-import a drop is harmless (it just
	// queues into the next batch).
	const busy = importing || reloading;

	const refreshStorage = useCallback(async () => {
		const [persisted, estimate] = await Promise.all([
			isStoragePersisted(),
			getStorageEstimate(),
		]);
		setStorage({
			persisted,
			usage: estimate?.usage ?? 0,
			quota: estimate?.quota ?? 0,
		});
	}, []);

	useEffect(() => {
		void refreshStorage();
	}, [refreshStorage]);

	const chooseMode = useCallback((next: ImportMode) => {
		setMode(next);
		try {
			localStorage.setItem(MODE_KEY, next);
		} catch {
			// private mode / storage disabled - the choice just is not remembered
		}
	}, []);

	/**
	 * Stage a drop: append the files to the batch and decide what each one is.
	 * Nothing is written until the user confirms, so a mis-drop can never wipe
	 * a dataset.
	 *
	 * Rows appear immediately with no verdict, then fill in as each file is
	 * read - one slow 2 GB file must not hold up the verdict on the next drop.
	 *
	 * Two files sharing a name are the same file only if their content
	 * signature matches, and that is not known until the head has been read. So
	 * a repeat is admitted provisionally and collapsed afterwards if its bytes
	 * turn out to be identical, while a same-named file with different content
	 * stays and gets a `-2` / `-3` label (see `disambiguateNames`).
	 */
	const stageFiles = useCallback(
		(files: File[]) => {
			// Cheap pre-filter on name+size+mtime: stops one file being staged twice
			// in the same tick, before we have paid to read its head.
			const fresh = files.filter((f) => !stagedKeys.current.has(fileKey(f)));
			if (fresh.length === 0) {
				if (files.length > 0) {
					setError(null);
					setNotice("Those files are already in this batch.");
				}
				return;
			}
			setError(null);
			setNotice(null);
			setResult(null);

			const entries = fresh.map((file) => {
				const key = fileKey(file);
				stagedKeys.current.add(key);
				return { key, file, verdict: null, signature: null, label: file.name };
			});
			commitStaged(relabel([...stagedRef.current, ...entries]));

			void classifyFiles(fresh)
				.then((verdicts) => {
					// Patch by key, not index: the list may have grown while this
					// classification was in flight.
					const byKey = new Map(
						verdicts.map((v, i) => {
							const file = fresh[i];
							return [file ? fileKey(file) : v.name, v];
						}),
					);
					const patched = stagedRef.current.map((e) => {
						const v = byKey.get(e.key);
						return v ? { ...e, verdict: v, signature: v.signature } : e;
					});
					// Now that signatures exist, collapse true duplicates: same name
					// AND same bytes is the same export, not a second one.
					const kept: StagedEntry[] = [];
					const dropped: string[] = [];
					for (const e of patched) {
						const isDuplicate =
							e.signature !== null &&
							kept.some((other) => other.signature === e.signature);
						if (isDuplicate) {
							stagedKeys.current.delete(e.key);
							dropped.push(e.file.name);
						} else {
							kept.push(e);
						}
					}
					commitStaged(relabel(kept));
					if (dropped.length > 0) {
						setNotice(
							`Ignored ${dropped.length} identical file${dropped.length === 1 ? "" : "s"} already in this batch: ${dropped.join(", ")}.`,
						);
					}
				})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					const failed = new Set(entries.map((e) => e.key));
					// Mark just these rows failed; the rest of the batch is fine.
					commitStaged(
						relabel(
							stagedRef.current.map((e) =>
								failed.has(e.key)
									? {
											...e,
											verdict: {
												name: e.file.name,
												size: e.file.size,
												role: "unknown" as const,
												reason: `Could not be read: ${message}`,
												signature: null,
											},
										}
									: e,
							),
						),
					);
				});
		},
		[commitStaged],
	);

	/** Pull one file back out of the batch (it can be dropped again later). */
	const removeStaged = useCallback(
		(key: string) => {
			stagedKeys.current.delete(key);
			// The notice names specific rows; it stops being true once one goes.
			setNotice(null);
			commitStaged(relabel(stagedRef.current.filter((e) => e.key !== key)));
		},
		[commitStaged],
	);

	const clearStaged = useCallback(() => {
		stagedKeys.current.clear();
		setNotice(null);
		commitStaged([]);
	}, [commitStaged]);

	const startImport = useCallback(
		async (files: File[], selectedMode: ImportMode) => {
			setImporting(true);
			setError(null);
			setNotice(null);
			setProgress({ phase: "read", fileIndex: 0, fileCount: files.length });
			// Park the store in "loading" for the whole run: views mounted elsewhere
			// then show a spinner instead of re-reading the DB mid-import (which
			// would see zero rows and stick them in a false "no data" state).
			useDatasetStore.setState({ status: "loading" });
			try {
				const imported = await ingestFiles(
					files,
					{ mode: selectedMode },
					{
						onProgress: setProgress,
					},
				);
				await requestPersistentStorage();
				// Other views read the dataset from the in-memory store - re-sync it
				// (and wait for it, so the UI stays busy until the data is actually
				// usable) so Music/Video reflect the new data immediately.
				setReloading(true);
				await useDatasetStore.getState().reload();
				if (imported.summary.likesWritten > 0) await likesReload();
				setResult(imported);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				// Failed import: re-read the DB so views fall back to its real state
				// (previous dataset if one existed, empty otherwise) instead of
				// staying parked in "loading" forever.
				void useDatasetStore.getState().reload();
			} finally {
				setImporting(false);
				setReloading(false);
				setProgress(null);
				clearStaged();
				void refreshStorage();
			}
		},
		[clearStaged, likesReload, refreshStorage],
	);

	/**
	 * Destructive path: snapshot first, then confirm with the real numbers.
	 * A snapshot turns "replace" from a one-way door into an undo.
	 */
	const confirmImport = useCallback(async () => {
		if (staged.length === 0) return;
		const hasDataset = (useDatasetStore.getState().meta?.rowCount ?? 0) > 0;
		if (mode === "replace" && hasDataset) {
			const { records } = useDatasetStore.getState();
			// Via the store, so the Snapshots list below re-renders with it.
			await useSnapshotsStore
				.getState()
				.save(`Before replace - ${new Date().toLocaleString()}`, records);
			if (
				!window.confirm(
					`Replace the current dataset (${records.length.toLocaleString()} streams)?\n\nA snapshot has been saved, so you can restore it from Snapshots below.`,
				)
			) {
				return;
			}
		}
		await startImport(
			staged.map((e) => e.file),
			mode,
		);
	}, [mode, staged, startImport]);

	const onDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			if (importing || reloading) return;
			// No filename or extension filter: classification decides what a
			// file is, so a Takeout folder can be dropped whole - and a second
			// drop appends to the batch instead of replacing it.
			stageFiles(Array.from(e.dataTransfer.files));
		},
		[importing, reloading, stageFiles],
	);

	const onPick = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			stageFiles(Array.from(e.target.files ?? []));
			e.target.value = "";
		},
		[stageFiles],
	);

	// Pull the example fixture (public/dev/example-watch-history.json, served
	// statically under the base path in dev and on GitHub Pages). Demo data is
	// always a replace: mixing it into a real dataset would poison the numbers.
	const loadExample = useCallback(async () => {
		if (busy) return;
		setError(null);
		try {
			const res = await fetch(
				`${import.meta.env.BASE_URL}dev/example-watch-history.json`,
			);
			if (!res.ok) {
				throw new Error(
					res.status === 404
						? "No example data available - public/dev/example-watch-history.json is missing."
						: `Example fetch failed (HTTP ${res.status}).`,
				);
			}
			const blob = await res.blob();
			await startImport(
				[
					new File([blob], "example-watch-history.json", {
						type: "application/json",
					}),
				],
				"replace",
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [busy, startImport]);

	const onClear = useCallback(async () => {
		if (
			!window.confirm(
				"Delete the imported dataset from this browser? This cannot be undone.",
			)
		)
			return;
		await clearDataset();
		await useDatasetStore.getState().reload();
		void refreshStorage();
	}, [refreshStorage]);

	const skipped = result?.verdicts.filter((v) => v.role === "unknown") ?? [];
	const rowCount = meta?.rowCount ?? 0;
	// Only meaningful while a run is in flight: null between imports, and during
	// "loading the dataset into memory" when the copy is about the reload rather
	// than about any file.
	const progressCopy = progress ? progressText(progress) : null;

	return (
		<section className="mx-auto max-w-2xl space-y-6">
			<div>
				<h1 className="text-2xl font-semibold">Import</h1>
				<p className="text-sm text-muted-foreground">
					Drop files from your Google Takeout export. Each file is identified by
					its contents, not its name, so you can add exports from different
					dates without renaming anything. Files are parsed entirely in your
					browser - nothing is uploaded anywhere.
				</p>
			</div>

			<button
				type="button"
				aria-label="Upload Takeout history files"
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				onClick={() => !importing && !reloading && inputRef.current?.click()}
				className={`flex min-h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
					dragging
						? "border-ring bg-accent/40"
						: "border-border hover:bg-accent/20"
				} ${importing || reloading ? "pointer-events-none opacity-60" : ""}`}
			>
				<input
					ref={inputRef}
					type="file"
					accept=".json,.csv,application/json,text/csv"
					multiple
					className="hidden"
					onChange={onPick}
				/>
				{importing && reloading ? (
					<>
						<p className="font-medium">Preparing analytics data…</p>
						<p className="text-sm text-muted-foreground">
							Loading the dataset into memory
						</p>
					</>
				) : importing && progressCopy ? (
					<>
						<p className="font-medium">{progressCopy.title}</p>
						{progressCopy.detail && (
							<p className="text-sm text-muted-foreground">
								{progressCopy.detail}
							</p>
						)}
					</>
				) : (
					<>
						<p className="font-medium">
							Drop Takeout files here, or click to browse
						</p>
						<p className="text-sm text-muted-foreground">
							{staged.length > 0
								? "Drop another file to add it to the batch below, or import what is staged"
								: "History parts, search history and playlist exports can all go in at once - each file is checked before anything is written"}
						</p>
					</>
				)}
			</button>

			{staged.length > 0 && (
				<ImportReview
					files={staged}
					mode={mode}
					onModeChange={chooseMode}
					onRemove={removeStaged}
					existing={rowCount > 0 ? { rowCount } : null}
					onConfirm={() => void confirmImport()}
					onCancel={clearStaged}
					busy={importing || reloading}
					notice={notice}
				/>
			)}

			{result && (
				<div className="rounded-lg border p-4">
					<h2 className="mb-2 font-medium">
						{result.summary.replaced ? "Dataset replaced" : "Added to dataset"}
					</h2>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
						<dt className="text-muted-foreground">New streams</dt>
						<dd className="text-right font-mono">
							{result.summary.insertedCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Already imported</dt>
						<dd className="text-right font-mono">
							{result.summary.overlapCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Streams in dataset</dt>
						<dd className="text-right font-mono">
							{result.summary.rowCount.toLocaleString()}
						</dd>
						{result.summary.likesWritten > 0 && (
							<>
								<dt className="text-muted-foreground">Liked tracks added</dt>
								<dd className="text-right font-mono">
									{result.summary.likesWritten.toLocaleString()}
								</dd>
							</>
						)}
					</dl>
					{skipped.length > 0 && (
						<ul className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
							{skipped.map((v) => (
								<li key={v.name}>
									<span className="font-mono">{v.name}</span> - {v.reason}
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			<div className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-4">
				<div>
					<h2 className="font-medium">Example data</h2>
					<p className="text-sm text-muted-foreground">
						Loads the bundled <code>example-watch-history.json</code>. Always
						replaces the current dataset, and saves a snapshot first if you have
						one.
					</p>
				</div>
				<Button
					variant="secondary"
					size="sm"
					disabled={busy}
					onClick={() => void loadExample()}
				>
					{busy ? "Loading…" : "Load example"}
				</Button>
			</div>

			{error && (
				<div
					role="alert"
					className="whitespace-pre-line rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
				>
					{error}
				</div>
			)}

			{meta && (
				<div className="rounded-lg border p-4">
					<div className="mb-3 flex items-center justify-between">
						<h2 className="font-medium">Imported dataset</h2>
						<Button
							variant="destructive"
							size="sm"
							disabled={busy}
							onClick={onClear}
						>
							Clear data
						</Button>
					</div>
					<dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
						<dt className="text-muted-foreground">Total streams</dt>
						<dd className="text-right font-mono">
							{meta.rowCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">YouTube Music</dt>
						<dd className="text-right font-mono">
							{meta.musicCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">YouTube</dt>
						<dd className="text-right font-mono">
							{meta.youtubeCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Unattributed music</dt>
						<dd className="text-right font-mono">
							{meta.unattributedMusic.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Duplicates skipped</dt>
						<dd className="text-right font-mono">
							{meta.duplicateCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Dropped rows</dt>
						<dd className="text-right font-mono">
							{meta.droppedCount.toLocaleString()}
						</dd>
						<dt className="text-muted-foreground">Files imported</dt>
						<dd className="text-right font-mono">{meta.fileCount}</dd>
						<dt className="text-muted-foreground">Date range</dt>
						<dd className="text-right font-mono text-xs">
							{formatDate(meta.minTs)} → {formatDate(meta.maxTs)}
						</dd>
						<dt className="text-muted-foreground">Imported</dt>
						<dd className="text-right font-mono text-xs">
							{formatDate(meta.importedAt)}
						</dd>
					</dl>
				</div>
			)}

			<LikesUpload />

			<SnapshotManager />

			<OriginLookupCard />

			<div className="rounded-lg border p-4 text-sm">
				<h2 className="mb-2 font-medium">Browser storage</h2>
				{storage ? (
					<dl className="grid grid-cols-2 gap-x-6 gap-y-1">
						<dt className="text-muted-foreground">Used</dt>
						<dd className="text-right font-mono">
							{formatBytes(storage.usage)}{" "}
							{storage.quota > 0 && `of ${formatBytes(storage.quota)}`}
						</dd>
						<dt className="text-muted-foreground">Eviction-protected</dt>
						<dd className="text-right">
							{storage.persisted === null
								? "unsupported"
								: storage.persisted
									? "yes"
									: "no"}
						</dd>
					</dl>
				) : (
					<p className="text-muted-foreground">Storage API unavailable.</p>
				)}
				<p className="mt-2 text-xs text-muted-foreground">
					Data persists in this browser across restarts and is only removed by
					clearing site data or the "Clear data" button above.
				</p>
			</div>
		</section>
	);
}
