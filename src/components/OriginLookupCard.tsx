import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDatasetStore } from "@/state/dataset";
import {
	clearOriginsCache,
	isOriginLookupOn,
	setOriginLookupOn,
	useOriginsStore,
} from "@/state/origins";

/**
 * Artist-origin lookup controls (Phase 7, BLUEPRINT §2.7). Toggled on by
 * default per user decision: while enabled the World Map page auto-starts
 * resolving uncached artists on open (MusicBrainz artist search + Open-
 * Meteo geocoding, 1 req/s on the MusicBrainz side), caching every result
 * locally so each artist is queried at most once.
 */
export function OriginLookupCard() {
	const cache = useOriginsStore((s) => s.cache);
	const reloadCache = useOriginsStore((s) => s.reload);
	const running = useOriginsStore((s) => s.running);
	const progress = useOriginsStore((s) => s.progress);
	const error = useOriginsStore((s) => s.error);
	const start = useOriginsStore((s) => s.start);
	const cancel = useOriginsStore((s) => s.cancel);
	const records = useDatasetStore((s) => s.records);
	// Import is often the first page visited - pull the dataset into memory
	// so pending-artist counts and the Run button reflect real state.
	const status = useDatasetStore((s) => s.status);
	const reloadData = useDatasetStore((s) => s.reload);

	const [on, setOn] = useState(isOriginLookupOn);

	useEffect(() => {
		reloadCache();
	}, [reloadCache]);

	useEffect(() => {
		if (status === "idle") reloadData();
	}, [status, reloadData]);

	const placed = cache.filter((c) => c.precision !== "miss").length;

	return (
		<div className="rounded-lg border p-4">
			<h2 className="mb-2 font-medium">Artist origins (world map)</h2>
			<p className="mb-3 text-sm text-muted-foreground">
				Look up where your artists are <em>from</em> - birth / foundation place,
				city first, else state, else country - via musicbrainz.org and
				geocoding-api.open-meteo.com, one request per second. Runs automatically
				when the World Map page is open while enabled; every result is cached in
				this browser (also survives "Clear data" above).
			</p>
			<label className="flex cursor-pointer items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={on}
					onChange={(e) => {
						setOn(e.target.checked);
						setOriginLookupOn(e.target.checked);
					}}
				/>
				Resolve artist origins automatically
			</label>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!on || running || records.length === 0}
					onClick={start}
				>
					Run now
				</Button>
				{running && (
					<Button variant="ghost" size="sm" onClick={cancel}>
						Cancel
					</Button>
				)}
				<span className="text-sm text-muted-foreground" aria-live="polite">
					{running
						? `${progress.done}/${progress.total} artists…`
						: `${placed.toLocaleString()} of ${cache.length.toLocaleString()} artist${cache.length === 1 ? "" : "s"} placed${cache.length > 0 ? " · rest not found" : ""}.`}
				</span>
				{cache.length > 0 && !running && (
					<Button
						variant="ghost"
						size="sm"
						className="ml-auto text-muted-foreground hover:text-foreground"
						onClick={() => void clearOriginsCache()}
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
