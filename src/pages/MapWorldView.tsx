import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { RequestFor } from "@/analytics/protocol";
import { ChartCard } from "@/components/ChartCard";
import {
	type MapMode,
	type MapPoint,
	WorldMap,
} from "@/components/charts/WorldMap";
import { LoadingDataset } from "@/components/LoadingDataset";
import {
	SKELETON_ROW_WIDTHS,
	SkeletonBar,
	SkeletonText,
} from "@/components/SkeletonText";
import type { ArtistOrigin } from "@/db/types";
import { isoNumeric } from "@/lib/iso";
import { SERIES_COLORS } from "@/lib/palette";
import { useDatasetStore } from "@/state/dataset";
import { useOriginsStore } from "@/state/origins";
import { useAnalytics } from "@/state/useAnalytics";

/**
 * World map of artist origins (Phase 7). All-time by definition - the
 * shared time filter deliberately does not apply here. Lookups auto-start
 * on open while the Import-page toggle is on; results render live.
 */
export default function MapWorldView() {
	const status = useDatasetStore((s) => s.status);
	const meta = useDatasetStore((s) => s.meta);
	const reload = useDatasetStore((s) => s.reload);
	const cache = useOriginsStore((s) => s.cache);
	const reloadCache = useOriginsStore((s) => s.reload);
	const running = useOriginsStore((s) => s.running);
	const progress = useOriginsStore((s) => s.progress);
	const [mode, setMode] = useState<MapMode>("dots");

	useEffect(() => {
		reloadCache();
	}, [reloadCache]);

	useEffect(() => {
		if (status === "idle") reload();
	}, [status, reload]);

	// Lookups auto-start at app root (App.tsx); this page only renders.

	// Lifetime plays per artist: one full-dataset pass, so it belongs in the
	// worker. No range - the map is all-time by design.
	const playsRequest = useMemo<RequestFor<"originPlays"> | null>(
		() =>
			status === "ready" && meta !== null ? { name: "originPlays" } : null,
		[status, meta],
	);
	const plays = useAnalytics(playsRequest);
	// Null until the worker's first answer lands. The memos below still have to
	// run (hooks are unconditional), so they read through it: an artist with no
	// ranking yet counts as 0 plays - the same answer the empty origins table
	// gives - and the ranking-derived pieces render as skeletons until it does.
	const artistPlays = plays.data;

	const points = useMemo<MapPoint[]>(() => {
		const rank = artistPlays;
		const playsOf = (artistKey: string): number =>
			rank?.get(artistKey)?.plays ?? 0;
		// Stale cache rows (artist no longer in the imported dataset) have no
		// plays - only artists actually listened to get displayed.
		const resolved = cache.filter(
			(
				c,
			): c is ArtistOrigin & {
				lat: number;
				lng: number;
				precision: "city" | "subdivision" | "country";
			} =>
				c.precision !== "miss" &&
				c.lat !== null &&
				c.lng !== null &&
				playsOf(c.artistKey) >= 1,
		);
		const groups = new Map<string, MapPoint>();
		for (const o of resolved) {
			const key = `${o.placeName ?? o.countryName ?? ""}|${o.countryCode ?? ""}`;
			let g = groups.get(key);
			if (!g) {
				g = {
					key,
					lat: o.lat,
					lng: o.lng,
					plays: 0,
					artists: [],
					place: o.placeName ?? o.countryName ?? "Unknown",
					precision: o.precision,
				};
				groups.set(key, g);
			}
			g.plays += playsOf(o.artistKey);
			g.artists.push({
				name: o.artistName,
				plays: playsOf(o.artistKey),
			});
		}
		return [...groups.values()]
			.map((g) => ({
				...g,
				artists: [...g.artists].sort((a, b) => b.plays - a.plays),
			}))
			.sort((a, b) => b.plays - a.plays);
	}, [cache, artistPlays]);

	const shadedIds = useMemo(
		() =>
			new Set(
				cache
					.filter(
						(c) =>
							c.precision !== "miss" &&
							(artistPlays?.get(c.artistKey)?.plays ?? 0) >= 1,
					)
					.map((c) => isoNumeric(c.countryCode))
					.filter((n): n is string => n !== null),
			),
		[cache, artistPlays],
	);

	if (status !== "ready") {
		return <LoadingDataset />;
	}
	if (!meta || meta.rowCount === 0) {
		return (
			<div className="p-6">
				<p className="text-sm text-muted-foreground">
					No data imported yet. Upload your Takeout history on the{" "}
					<Link to="/import" className="underline">
						Import
					</Link>{" "}
					page.
				</p>
			</div>
		);
	}
	// The map's own SVG is cheap, but the ranking behind it is a full pass. The
	// page renders its real structure meanwhile; the ranking-derived text and
	// map body stand in as skeletons until it lands (see SkeletonText).
	if (plays.error && artistPlays === null) throw new Error(plays.error);
	const loading = artistPlays === null;
	const placed = cache.filter((c) => c.precision !== "miss").length;

	return (
		<div className="space-y-6" aria-busy={loading || running}>
			{loading && (
				<div role="status" aria-live="polite" className="sr-only">
					Ranking your artists…
				</div>
			)}
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h1 className="text-lg font-semibold">World map</h1>
				<p className="text-sm text-muted-foreground" aria-live="polite">
					{loading ? (
						<SkeletonText width="24ch" />
					) : running ? (
						`Resolving origins… ${progress.done}/${progress.total} artists (controls on the Import page)`
					) : (
						`${placed.toLocaleString()}/${cache.length.toLocaleString()} artists placed`
					)}
				</p>
			</div>

			<ChartCard
				title="Where your artists come from"
				subtitle="All-time · artist birth / foundation place, city precision preferred"
				height={480}
				loading={loading}
				actions={<ModeSwitch mode={mode} onMode={setMode} />}
			>
				{!loading && (
					<WorldMap points={points} shadedIds={shadedIds} mode={mode} />
				)}
			</ChartCard>

			<ChartCard
				title="Artist origins"
				subtitle="Ranked by all-time plays; unresolved artists listed last"
				height={Math.max(240, Math.min(560, cache.length * 28 + 40))}
			>
				<OriginTable
					cache={cache}
					artistPlays={loading ? null : artistPlays}
					loading={loading}
				/>
			</ChartCard>
		</div>
	);
}

const PRECISION_LABEL: Record<ArtistOrigin["precision"], string> = {
	city: "City",
	subdivision: "State / region",
	country: "Country",
	miss: "Not found",
};

const MODE_LABEL: Record<MapMode, string> = {
	dots: "Dots",
	heat: "Heatmap",
	"heat-plays": "Heatmap · plays",
};

function ModeSwitch({
	mode,
	onMode,
}: {
	mode: MapMode;
	onMode: (mode: MapMode) => void;
}) {
	return (
		<fieldset
			aria-label="Map view mode"
			className="flex overflow-hidden rounded-md border"
		>
			{(Object.keys(MODE_LABEL) as MapMode[]).map((m) => (
				<button
					key={m}
					type="button"
					aria-pressed={mode === m}
					className={`border-l border-border px-2.5 py-1 text-xs transition-colors first:border-l-0 ${
						mode === m
							? "bg-accent text-accent-foreground"
							: "text-muted-foreground hover:bg-accent/60"
					}`}
					onClick={() => onMode(m)}
				>
					{MODE_LABEL[m]}
				</button>
			))}
		</fieldset>
	);
}

function OriginTable({
	cache,
	artistPlays,
	loading = false,
}: {
	cache: ArtistOrigin[];
	/** Null while the ranking pass is still running. */
	artistPlays: Map<string, { artist: string; plays: number }> | null;
	loading?: boolean;
}) {
	const rows = useMemo(
		() =>
			[...cache]
				.map((o) => ({
					...o,
					plays: artistPlays?.get(o.artistKey)?.plays ?? 0,
				}))
				.sort(
					(a, b) =>
						(b.precision === "miss" ? 0 : b.plays) -
							(a.precision === "miss" ? 0 : a.plays) ||
						b.plays - a.plays ||
						a.artistName.localeCompare(b.artistName),
				),
		[cache, artistPlays],
	);

	if (loading) {
		return (
			<div className="h-full overflow-y-auto" aria-hidden="true">
				<table className="w-full text-sm">
					<thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
						<tr>
							<th className="px-2 py-1.5 font-medium">#</th>
							<th className="px-2 py-1.5 font-medium">Artist</th>
							<th className="px-2 py-1.5 font-medium">Origin</th>
							<th className="px-2 py-1.5 font-medium">Country</th>
							<th className="px-2 py-1.5 text-right font-medium">Plays</th>
						</tr>
					</thead>
					<tbody>
						{SKELETON_ROW_WIDTHS.map((w) => (
							<tr key={w} className="border-t border-border/60">
								<td className="px-2 py-1.5">
									<SkeletonBar width="2ch" height="1rem" />
								</td>
								<td className="px-2 py-1.5">
									<SkeletonBar width={w} height="1rem" />
								</td>
								<td className="px-2 py-1.5">
									<SkeletonBar width="45%" height="1rem" />
								</td>
								<td className="px-2 py-1.5">
									<SkeletonBar width="7ch" height="1rem" />
								</td>
								<td className="px-2 py-1.5 text-right">
									<SkeletonBar width="6ch" height="1rem" />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	if (rows.length === 0) {
		return (
			<div className="grid h-full place-items-center">
				<p className="text-sm text-muted-foreground">
					No origins resolved yet - enable lookups on the Import page or wait
					for the run to finish.
				</p>
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<table className="w-full text-sm">
				<thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
					<tr>
						<th className="px-2 py-1.5 font-medium">#</th>
						<th className="px-2 py-1.5 font-medium">Artist</th>
						<th className="px-2 py-1.5 font-medium">Origin</th>
						<th className="px-2 py-1.5 font-medium">Country</th>
						<th className="px-2 py-1.5 text-right font-medium">Plays</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r, i) => {
						const origin = [r.placeName, r.subdivisionName, r.countryName]
							.filter((p) => p !== null)
							.join(", ");
						const mismatch =
							r.resolvedName !== null &&
							r.resolvedName.toLowerCase() !== r.artistName.toLowerCase();
						return (
							<tr key={r.artistKey} className="border-t border-border/60">
								<td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
								<td className="px-2 py-1.5">
									{r.artistName}
									{mismatch && (
										<span
											className="ml-1.5 text-xs text-muted-foreground"
											title="Name MusicBrainz resolved this lookup to"
										>
											(“{r.resolvedName}”)
										</span>
									)}
								</td>
								<td className="px-2 py-1.5">
									<span
										className={`mr-2 rounded border px-1.5 py-0.5 text-xs ${
											r.precision === "city"
												? "border-transparent"
												: "text-muted-foreground"
										}`}
										style={
											r.precision === "city"
												? { color: SERIES_COLORS[0] }
												: undefined
										}
									>
										{PRECISION_LABEL[r.precision]}
									</span>
									{origin || "-"}
								</td>
								<td className="px-2 py-1.5 text-muted-foreground">
									{r.countryName ?? "-"}
								</td>
								<td className="px-2 py-1.5 text-right font-mono tabular-nums">
									{r.precision === "miss" ? "-" : r.plays.toLocaleString()}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
