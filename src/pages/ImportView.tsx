import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { LikesUpload } from "@/components/LikesUpload";
import { MusicBrainzCard } from "@/components/MusicBrainzCard";
import { OriginLookupCard } from "@/components/OriginLookupCard";
import { SnapshotManager } from "@/components/SnapshotManager";
import { Button } from "@/components/ui/button";
import { clearDataset, getDatasetMeta } from "@/db/db";
import type { DatasetMeta } from "@/db/types";
import { type IngestProgress, ingestFiles } from "@/ingestion/ingestClient";
import {
  formatBytes,
  getStorageEstimate,
  isStoragePersisted,
  requestPersistentStorage,
} from "@/lib/storage";
import { useDatasetStore } from "@/state/dataset";
import { useLikesStore } from "@/state/likes";

const PHASE_LABEL: Record<IngestProgress["phase"], string> = {
  read: "Reading file",
  normalize: "Parsing & normalizing",
  persist: "Writing to local database",
};

function formatDate(ts: number): string {
  return ts ? new Date(ts).toLocaleString() : "-";
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
  const [storage, setStorage] = useState<{
    persisted: boolean | null;
    usage: number;
    quota: number;
  } | null>(null);

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

  const startImport = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setImporting(true);
      setError(null);
      setProgress({ phase: "read", fileIndex: 0, fileCount: files.length });
      // Park the store in "loading" for the whole run: views mounted elsewhere
      // then show a spinner instead of re-reading the DB mid-import (which
      // would see zero rows and stick them in a false "no data" state).
      useDatasetStore.setState({ status: "loading" });
      try {
        await ingestFiles(files, {
          onProgress: setProgress,
        });
        await requestPersistentStorage();
        // Other views read the dataset from the in-memory store - re-sync it
        // (and wait for it, so the UI stays busy until the data is actually
        // usable) so Music/Overview reflect the new data immediately.
        setReloading(true);
        await useDatasetStore.getState().reload();
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
        void refreshStorage();
      }
    },
    [refreshStorage],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (importing || reloading) return;
      void startImport(
        Array.from(e.dataTransfer.files).filter((f) =>
          f.name.endsWith(".json"),
        ),
      );
    },
    [importing, reloading, startImport],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void startImport(Array.from(e.target.files ?? []));
      e.target.value = "";
    },
    [startImport],
  );

  // Dev only: pull the gitignored watch-history.json from the dev server
  // (vite exampleHistoryPlugin) so navigating during development doesn't
  // require re-uploading a Takeout export.
  const loadExample = useCallback(async () => {
    if (importing || reloading) return;
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}dev/watch-history.json`,
      );
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? "No watch-history.json found in the project root - example mode has nothing to load."
            : `Example fetch failed (HTTP ${res.status}).`,
        );
      }
      const blob = await res.blob();
      await startImport([
        new File([blob], "watch-history.json", { type: "application/json" }),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [importing, reloading, startImport]);

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

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="text-sm text-muted-foreground">
          Upload <code>watch-history.json</code> from your Google Takeout
          export. Files are parsed entirely in your browser - nothing is
          uploaded anywhere.
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
          accept=".json,application/json"
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
        ) : importing && progress ? (
          <>
            <p className="font-medium">
              {PHASE_LABEL[progress.phase]}… (file {progress.fileIndex + 1}/
              {progress.fileCount})
            </p>
            {typeof progress.rows === "number" && (
              <p className="text-sm text-muted-foreground">
                {progress.rows.toLocaleString()} streams kept
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-medium">
              Drop Takeout JSON files here, or click to browse
            </p>
            <p className="text-sm text-muted-foreground">
              Multiple parts (watch-history(1).json, …) are merged and deduped
            </p>
          </>
        )}
      </button>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed p-4">
        <div>
          <h2 className="font-medium">Example data</h2>
          <p className="text-sm text-muted-foreground">
            Loads <code>watch-history.json</code> from the project root via the
            dev server. Replaces the current dataset.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={importing || reloading}
          onClick={() => void loadExample()}
        >
          {importing || reloading ? "Loading…" : "Load example"}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
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
              disabled={importing || reloading}
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

      <MusicBrainzCard />

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
