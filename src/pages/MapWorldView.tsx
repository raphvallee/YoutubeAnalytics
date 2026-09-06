import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { ChartCard } from "@/components/ChartCard";
import { type MapPoint, WorldMap } from "@/components/charts/WorldMap";
import { LoadingDataset } from "@/components/LoadingDataset";
import type { ArtistOrigin } from "@/db/types";
import { isoNumeric } from "@/lib/iso";
import { SERIES_COLORS } from "@/lib/palette";
import { useDatasetStore } from "@/state/dataset";
import { originTargets, useOriginsStore } from "@/state/origins";

/**
 * World map of artist origins (Phase 7). All-time by definition - the
 * shared time filter deliberately does not apply here. Lookups auto-start
 * on open while the Import-page toggle is on; results render live.
 */
export default function MapWorldView() {
	const { status, records, meta, reload } = useDatasetStore();
	const cache = useOriginsStore((s) => s.cache);
	const reloadCache = useOriginsStore((s) => s.reload);
	const running = useOriginsStore((s) => s.running);
	const progress = useOriginsStore((s) => s.progress);

	useEffect(() => {
		reloadCache();
	}, [reloadCache]);

	useEffect(() => {
		if (status === "idle") reload();
	}, [status, reload]);

	// Auto-start when opened with data (no-ops otherwise: running, toggled
	// off, or nothing uncached). start() reads the store's own records.
	const start = useOriginsStore((s) => s.start);
	const hasRecords = records.length > 0;
	useEffect(() => {
		if (status === "ready" && hasRecords) start();
	}, [status, hasRecords, start]);

	const artistPlays = useMemo(() => {
		const m = new Map<string, { artist: string; plays: number }>();
		for (const t of originTargets(records, [])) m.set(t.artistKey, t);
		return m;
	}, [records]);

	const points = useMemo<MapPoint[]>(() => {
		const resolved = cache.filter(
			(
				c,
			): c is ArtistOrigin & {
				lat: number;
				lng: number;
				precision: "city" | "subdivision" | "country";
			} => c.precision !== "miss" && c.lat !== null && c.lng !== null,
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
			g.plays += artistPlays.get(o.artistKey)?.plays ?? 0;
			g.artists.push({
				name: o.artistName,
				plays: artistPlays.get(o.artistKey)?.plays ?? 0,
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
					.map((c) => isoNumeric(c.countryCode))
					.filter((n): n is string => n !== null),
			),
		[cache],
	);

	if (status !== "ready") {
		return <LoadingDataset />;
	}
	if (!meta || records.length === 0) {
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

	const placed = cache.filter((c) => c.precision !== "miss").length;

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h1 className="text-lg font-semibold">World map</h1>
				<p className="text-sm text-muted-foreground" aria-live="polite">
					{running
						? `Resolving origins… ${progress.done}/${progress.total} artists (controls on the Import page)`
						: `${placed.toLocaleString()}/${cache.length.toLocaleString()} artists placed`}
				</p>
			</div>

			<ChartCard
				title="Where your artists come from"
				subtitle="All-time · artist birth / foundation place, city precision preferred"
				height={480}
			>
				<WorldMap points={points} shadedIds={shadedIds} />
			</ChartCard>

			<ChartCard
				title="Artist origins"
				subtitle="Ranked by all-time plays; unresolved artists listed last"
				height={Math.max(240, Math.min(560, cache.length * 28 + 40))}
			>
				<OriginTable cache={cache} artistPlays={artistPlays} />
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

function OriginTable({
	cache,
	artistPlays,
}: {
	cache: ArtistOrigin[];
	artistPlays: Map<string, { artist: string; plays: number }>;
}) {
	const rows = useMemo(
		() =>
			[...cache]
				.map((o) => ({
					...o,
					plays: artistPlays.get(o.artistKey)?.plays ?? 0,
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
