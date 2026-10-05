import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { autoBucket } from "@/analytics/buckets";
import type { RequestFor } from "@/analytics/protocol";
import { estSeconds } from "@/analytics/queries";
import type { ReleaseAgg } from "@/analytics/releases";
import { ArtistDrawer } from "@/components/ArtistDrawer";
import { ArtistLeaderboard } from "@/components/ArtistLeaderboard";
import { ChartCard } from "@/components/ChartCard";
import { ComparePicker } from "@/components/ComparePicker";
import { ArtistAffinityChart } from "@/components/charts/ArtistAffinityChart";
import { StackedErasChart } from "@/components/charts/StackedErasChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { LoadingDataset } from "@/components/LoadingDataset";
import { PageSkeleton } from "@/components/PageSkeleton";
import { ReleaseLeaderboard } from "@/components/ReleaseLeaderboard";
import { RangeLabel, TimeFilterToolbar } from "@/components/TimeFilterToolbar";
import { TopTracksTable } from "@/components/TopTracksTable";
import { formatDuration } from "@/lib/format";
import { useDatasetStore } from "@/state/dataset";
import { resolveRange, useFilterStore } from "@/state/filters";
import { useLikesStore } from "@/state/likes";
import { useSnapshotsStore } from "@/state/snapshots";
import { useAnalytics } from "@/state/useAnalytics";

/** See the `releases` memo: there is no release data source to aggregate. */
const NO_RELEASES: ReleaseAgg[] = [];

export default function MusicView() {
	const status = useDatasetStore((s) => s.status);
	const meta = useDatasetStore((s) => s.meta);
	const reload = useDatasetStore((s) => s.reload);
	const likeCount = useLikesStore((s) => s.count);
	const likesReload = useLikesStore((s) => s.reload);
	const snapActive = useSnapshotsStore((s) => s.active);
	const snapshotsReload = useSnapshotsStore((s) => s.reload);
	const filterState = useFilterStore();

	useEffect(() => {
		likesReload();
		snapshotsReload();
	}, [likesReload, snapshotsReload]);

	useEffect(() => {
		if (status === "idle") reload();
	}, [status, reload]);

	const { range, label } = useMemo(
		() =>
			resolveRange(filterState, meta?.minTs ?? 0, meta?.maxTs ?? Date.now()),
		[filterState, meta],
	);
	// Depend on the range's two primitives, not the `range` object. `resolveRange`
	// mints a fresh object on every call, so an object dep invalidated every
	// request below on every filter-store write - including every keystroke in
	// the custom-date inputs. Do NOT narrow the deps of the memo above: it calls
	// `Date.now()` for the relative presets, so keying it on from/to would freeze
	// "Last 7 days" at whatever instant it first resolved.
	const { from, to } = range;
	const affinityBucket = autoBucket(from, to);

	// Phase 6 snapshot compare. `selected` is the drawer, which only mounts an
	// artist query once the user picks a row.
	const [selected, setSelected] = useState<{
		key: string;
		name: string;
	} | null>(null);
	const [expand, setExpand] = useState(false);

	// One request per page, answered by the worker. Null while the dataset is
	// still loading, so the worker is never asked to aggregate rows the UI has
	// not confirmed yet.
	const ready = status === "ready" && meta !== null;
	const dashboardRequest = useMemo<RequestFor<"musicDashboard"> | null>(
		() => (ready ? { name: "musicDashboard", range: { from, to } } : null),
		[ready, from, to],
	);
	const dashboard = useAnalytics(dashboardRequest);

	// Likes are a separate dataset from an opt-in upload, so a separate request:
	// uploading one must not invalidate the leaderboard cache.
	const likesRequest = useMemo<RequestFor<"likesDashboard"> | null>(
		() => (ready && likeCount > 0 ? { name: "likesDashboard" } : null),
		[ready, likeCount],
	);
	const likesMatch = useAnalytics(likesRequest);

	const artistRequest = useMemo<RequestFor<"artistDashboard"> | null>(
		() =>
			ready && selected !== null
				? {
						name: "artistDashboard",
						range: { from, to },
						artistKey: selected.key,
						bucket: affinityBucket,
					}
				: null,
		[ready, selected, from, to, affinityBucket],
	);
	const artist = useAnalytics(artistRequest);

	// Compare needs the leaderboard rows it will annotate, so it is asked for
	// only once those exist - not on the empty-range render that precedes them.
	const compareRequest = useMemo<RequestFor<"compare"> | null>(() => {
		if (!ready || snapActive === null || dashboard.data === null) return null;
		return {
			name: "compare",
			range: { from, to },
			bucket: affinityBucket,
			artists: dashboard.data.artists,
			snapshotId: snapActive.id,
		};
	}, [ready, snapActive, dashboard.data, from, to, affinityBucket]);
	const compare = useAnalytics(compareRequest);

	// Stable identities so the memoized leaderboard / drawer can actually bail
	// out. Without these a fresh closure per render defeats React.memo entirely.
	const selectArtist = useCallback((key: string, name: string) => {
		setSelected({ key, name });
	}, []);
	const closeDrawer = useCallback(() => setSelected(null), []);

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
	// First paint after a navigation: no numbers yet, so show the shape of the
	// page instead of blocking the thread on a synchronous pass over the rows.
	if (dashboard.pending) return <PageSkeleton />;

	const data = dashboard.data;
	// A page-mount request always resolves, so a null here means the worker
	// died between the render and the answer.
	if (!data && dashboard.error) throw new Error(dashboard.error);
	if (!data) return <PageSkeleton />;

	// No release-enrichment data source is wired up (there is no `mbReleases`
	// table and no writer), so `topReleases` could only ever return []. Computing
	// it meant a full 120k scan to guarantee an empty list; the card renders its
	// empty state either way.
	const releases = NO_RELEASES;
	const summary = data.summary;
	const likesByArtist =
		likesMatch.data && likesMatch.data.total > 0
			? likesMatch.data.byArtist
			: undefined;

	return (
		<div className="space-y-6">
			<TimeFilterToolbar years={data.years} />
			<ComparePicker />

			{dashboard.error && (
				<p role="alert" className="text-sm text-destructive">
					Could not update these numbers: {dashboard.error}
				</p>
			)}

			<section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<Stat label="Music plays" value={summary.totalPlays.toLocaleString()} />
				<Stat label="Artists" value={summary.uniqueArtists.toLocaleString()} />
				<Stat
					label="Unique tracks"
					value={summary.uniqueTracks.toLocaleString()}
				/>
				<Stat
					label="Est. listening"
					value={formatDuration(estSeconds(summary.totalPlays))}
					hint="plays × 3.5 min"
				/>
			</section>

			<ChartCard
				title="Favorite artists"
				subtitle={<RangeLabelSpan min={meta.minTs} max={meta.maxTs} />}
			>
				<ArtistLeaderboard
					artists={data.artists}
					onSelect={selectArtist}
					likesByArtist={likesByArtist}
					deltas={compare.data?.deltas ?? undefined}
				/>
			</ChartCard>

			{compare.data && (
				<ChartCard
					title={`Compare: ${snapActive?.name ?? ""}`}
					subtitle={`Total music plays per ${affinityBucket}, current vs snapshot`}
				>
					<TrendLineChart
						data={compare.data.currentTrend}
						compareData={compare.data.snapshotTrend ?? undefined}
						label={`Compare trend: total music plays per ${affinityBucket} for the current dataset and snapshot ${snapActive?.name ?? ""}`}
					/>
				</ChartCard>
			)}

			<ChartCard
				title="Taste over time"
				subtitle="Monthly plays, top 8 artists + Other"
				actions={
					<fieldset
						className="flex overflow-hidden rounded-md border text-xs"
						aria-label="Stack mode"
					>
						<button
							type="button"
							className={`px-2 py-1 ${!expand ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
							onClick={() => setExpand(false)}
						>
							Absolute
						</button>
						<button
							type="button"
							className={`px-2 py-1 ${expand ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
							onClick={() => setExpand(true)}
						>
							Share
						</button>
					</fieldset>
				}
			>
				<StackedErasChart
					rows={data.macro.rows}
					seriesNames={data.macro.seriesNames}
					expand={expand}
				/>
			</ChartCard>

			<ChartCard
				title="Track eras"
				subtitle="Monthly plays of the top 8 tracks in range"
			>
				<StackedErasChart
					rows={data.eras.rows}
					seriesNames={data.eras.seriesNames}
				/>
			</ChartCard>

			<ChartCard
				title="Releases"
				subtitle="'Release - Topic' uploads, ranked by plays"
			>
				<ReleaseLeaderboard releases={releases} />
			</ChartCard>

			<ChartCard
				title="Top tracks"
				subtitle={<RangeLabelSpan min={meta.minTs} max={meta.maxTs} />}
			>
				<TopTracksTable tracks={data.tracks} />
			</ChartCard>

			<ArtistDrawer
				open={selected !== null}
				onClose={closeDrawer}
				title={selected?.name ?? ""}
			>
				{selected && (
					<div className="space-y-6">
						{artist.pending ? (
							<p className="text-sm text-muted-foreground">
								Crunching this artist…
							</p>
						) : artist.data ? (
							<>
								<p className="text-sm text-muted-foreground">
									{artist.data.affinityTotal.toLocaleString()} plays · est.{" "}
									{formatDuration(estSeconds(artist.data.affinityTotal))} ·{" "}
									{label}
								</p>
								<div>
									<h3 className="mb-2 text-sm font-medium">
										Play frequency (
										{affinityBucket === "week"
											? "weekly"
											: affinityBucket === "month"
												? "monthly"
												: "yearly"}
										)
									</h3>
									<div className="h-64">
										<ArtistAffinityChart points={artist.data.affinity} />
									</div>
								</div>
								{artist.data.eras.seriesNames.length > 0 && (
									<div>
										<h3 className="mb-2 text-sm font-medium">
											Top tracks over time
										</h3>
										<StackedErasChart
											rows={artist.data.eras.rows}
											seriesNames={artist.data.eras.seriesNames}
											height={240}
										/>
									</div>
								)}
								<div>
									<h3 className="mb-2 text-sm font-medium">Top tracks</h3>
									<TopTracksTable
										tracks={artist.data.tracks}
										showArtist={false}
									/>
								</div>
							</>
						) : (
							<p className="text-sm text-muted-foreground">
								No data for this artist in range.
							</p>
						)}
					</div>
				)}
			</ArtistDrawer>
		</div>
	);
}

/** Uses the shared filter label; min/max come from the dataset meta. */
function RangeLabelSpan({ min, max }: { min: number; max: number }) {
	return <RangeLabel dataMin={min} dataMax={max} />;
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<div className="rounded-lg border p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
			{hint && <p className="text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}
