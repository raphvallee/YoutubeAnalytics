import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDatasetStore } from "@/state/dataset";
import {
	clearEnrichmentCache,
	isMbOptIn,
	setMbOptIn,
	useEnrichmentStore,
} from "@/state/enrichment";

/**
 * Opt-in MusicBrainz enrichment (Phase 6, BLUEPRINT §2.5). This card hosts
 * the app's single deliberate exception to "no external API calls": off by
 * default, requires an explicit toggle, and caches every lookup locally so
 * each Release-Topic channelId is queried at most once (1 req/s).
 */
export function MusicBrainzCard() {
	const cache = useEnrichmentStore((s) => s.cache);
	const reloadCache = useEnrichmentStore((s) => s.reload);
	const running = useEnrichmentStore((s) => s.running);
	const progress = useEnrichmentStore((s) => s.progress);
	const error = useEnrichmentStore((s) => s.error);
	const run = useEnrichmentStore((s) => s.run);
	const records = useDatasetStore((s) => s.records);

	const [optIn, setOptIn] = useState(isMbOptIn);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		reloadCache();
	}, [reloadCache]);

	const resolved = cache.filter((c) => c.releaseName !== null).length;

	const onEnrich = () => {
		const controller = new AbortController();
		abortRef.current = controller;
		void run(controller.signal);
	};

	return (
		<div className="rounded-lg border p-4">
			<h2 className="mb-2 font-medium">MusicBrainz enrichment (optional)</h2>
			<p className="mb-3 text-sm text-muted-foreground">
				Look up release and artist names for the <code>Release - Topic</code>{" "}
				rows YouTube strips. This is the only feature that talks to the network
				(musicbrainz.org) - off unless you enable it here, one request per
				second, results cached in this browser.
			</p>
			<label className="flex cursor-pointer items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={optIn}
					onChange={(e) => {
						setOptIn(e.target.checked);
						setMbOptIn(e.target.checked);
					}}
				/>
				Allow MusicBrainz lookups
			</label>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!optIn || running || records.length === 0}
					onClick={onEnrich}
				>
					Enrich now
				</Button>
				{running && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => abortRef.current?.abort()}
					>
						Cancel
					</Button>
				)}
				<span className="text-sm text-muted-foreground" aria-live="polite">
					{running
						? `${progress.done}/${progress.total} lookups…`
						: `${resolved.toLocaleString()} release${resolved === 1 ? "" : "s"} resolved${cache.length > resolved ? `, ${cache.length - resolved} misses` : ""}.`}
				</span>
				{cache.length > 0 && !running && (
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto text-muted-foreground hover:text-foreground"
						onClick={() => void clearEnrichmentCache()}
					>
						Clear cache
					</Button>
				)}
			</div>
			{error && (
				<div role="alert" className="mt-3 text-sm text-destructive">
					{error}
				</div>
			)}
		</div>
	);
}
