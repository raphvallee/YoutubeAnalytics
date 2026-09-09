import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { autoBucket } from "@/analytics/buckets";
import { compareArtists } from "@/analytics/compare";
import { matchLikes } from "@/analytics/likes";
import {
	availableYears,
	estSeconds,
	macroSeries,
	musicSummary,
	scopedSeries,
	topArtists,
	topTracks,
	trackErasSeries,
} from "@/analytics/queries";
import { topReleases } from "@/analytics/releases";
import { ArtistDrawer } from "@/components/ArtistDrawer";
import { ArtistLeaderboard } from "@/components/ArtistLeaderboard";
import { ChartCard } from "@/components/ChartCard";
import { ComparePicker } from "@/components/ComparePicker";
import { ArtistAffinityChart } from "@/components/charts/ArtistAffinityChart";
import { StackedErasChart } from "@/components/charts/StackedErasChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { LoadingDataset } from "@/components/LoadingDataset";
import { ReleaseLeaderboard } from "@/components/ReleaseLeaderboard";
import { RangeLabel, TimeFilterToolbar } from "@/components/TimeFilterToolbar";
import { TopTracksTable } from "@/components/TopTracksTable";
import { formatDuration } from "@/lib/format";
import { useDatasetStore } from "@/state/dataset";
import { resolveRange, useFilterStore } from "@/state/filters";
import { useLikesStore } from "@/state/likes";
import { useSnapshotsStore } from "@/state/snapshots";

export default function MusicView() {
	const { status, records, meta, reload } = useDatasetStore();
	const filterState = useFilterStore();
	const likes = useLikesStore((s) => s.likes);
	const likesReload = useLikesStore((s) => s.reload);
	const snapActive = useSnapshotsStore((s) => s.active);
	const snapRecords = useSnapshotsStore((s) => s.records);
	const snapshotsReload = useSnapshotsStore((s) => s.reload);

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

	const years = useMemo(() => availableYears(records), [records]);
	const summary = useMemo(() => musicSummary(records, range), [records, range]);
	const artists = useMemo(
		() => topArtists(records, range, {}, 25),
		[records, range],
	);
	const tracks = useMemo(
		() => topTracks(records, range, {}, { limit: 25 }),
		[records, range],
	);
	const macro = useMemo(
		() => macroSeries(records, range, { bucket: "month", topN: 8 }),
		[records, range],
	);
	const eras = useMemo(
		() => trackErasSeries(records, range, { bucket: "month", topN: 8 }),
		[records, range],
	);

	const likesMatch = useMemo(
		() => matchLikes(likes, records),
		[likes, records],
	);

	// Phase 6 snapshot compare (computed only while a snapshot is selected).
	const [selected, setSelected] = useState<{
		key: string;
		name: string;
	} | null>(null);
	const [expand, setExpand] = useState(false);

	const affinityBucket = autoBucket(range.from, range.to);
	const currentTrend = useMemo(
		() => scopedSeries(records, range, affinityBucket, {}, { kind: "music" }),
		[records, range, affinityBucket],
	);
	const snapTrend = useMemo(
		() =>
			snapRecords
				? scopedSeries(
						snapRecords,
						range,
						affinityBucket,
						{},
						{ kind: "music" },
					)
				: null,
		[snapRecords, range, affinityBucket],
	);
	const deltas = useMemo(
		() =>
			snapRecords ? compareArtists(artists, snapRecords, range) : undefined,
		[artists, snapRecords, range],
	);
	const releases = useMemo(
		() => topReleases(records, [], range),
		[records, range],
	);

	const affinity = useMemo(
		() =>
			selected
				? scopedSeries(
						records,
						range,
						affinityBucket,
						{},
						{ kind: "music", artistKey: selected.key },
					)
				: [],
		[records, range, affinityBucket, selected],
	);
	const affinityTotal = useMemo(
		() => affinity.reduce((s, p) => s + p.plays, 0),
		[affinity],
	);
	const artistTracks = useMemo(
		() =>
			selected
				? topTracks(records, range, {}, { artistKey: selected.key, limit: 10 })
				: [],
		[records, range, selected],
	);
	const artistEras = useMemo(
		() =>
			selected
				? trackErasSeries(records, range, {
						bucket: "month",
						topN: 8,
						artistKey: selected.key,
					})
				: null,
		[records, range, selected],
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

	return (
		<div className="space-y-6">
			<TimeFilterToolbar years={years} />
			<ComparePicker />

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
					artists={artists}
					onSelect={(key, name) => setSelected({ key, name })}
					likesByArtist={likesMatch.total > 0 ? likesMatch.byArtist : undefined}
					deltas={deltas}
				/>
			</ChartCard>

			{snapActive && (
				<ChartCard
					title={`Compare: ${snapActive.name}`}
					subtitle={`Total music plays per ${affinityBucket}, current vs snapshot`}
				>
					<TrendLineChart
						data={currentTrend}
						compareData={snapTrend ?? undefined}
						label={`Compare trend: total music plays per ${affinityBucket} for the current dataset and snapshot ${snapActive.name}`}
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
					rows={macro.rows}
					seriesNames={macro.seriesNames}
					expand={expand}
				/>
			</ChartCard>

			<ChartCard
				title="Track eras"
				subtitle="Monthly plays of the top 8 tracks in range"
			>
				<StackedErasChart rows={eras.rows} seriesNames={eras.seriesNames} />
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
				<TopTracksTable tracks={tracks} />
			</ChartCard>

			<ArtistDrawer
				open={selected !== null}
				onClose={() => setSelected(null)}
				title={selected?.name ?? ""}
			>
				{selected && (
					<div className="space-y-6">
						<p className="text-sm text-muted-foreground">
							{affinityTotal.toLocaleString()} plays · est.{" "}
							{formatDuration(estSeconds(affinityTotal))} · {label}
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
								<ArtistAffinityChart points={affinity} />
							</div>
						</div>
						{artistEras && artistEras.seriesNames.length > 0 && (
							<div>
								<h3 className="mb-2 text-sm font-medium">
									Top tracks over time
								</h3>
								<StackedErasChart
									rows={artistEras.rows}
									seriesNames={artistEras.seriesNames}
									height={240}
								/>
							</div>
						)}
						<div>
							<h3 className="mb-2 text-sm font-medium">Top tracks</h3>
							<TopTracksTable tracks={artistTracks} showArtist={false} />
						</div>
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
