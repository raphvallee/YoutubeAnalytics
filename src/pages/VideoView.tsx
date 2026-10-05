import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { autoBucket } from "@/analytics/buckets";
import type { RequestFor } from "@/analytics/protocol";
import { ChannelLeaderboard } from "@/components/ChannelLeaderboard";
import { ChartCard } from "@/components/ChartCard";
import { BarsChart } from "@/components/charts/BarsChart";
import { HeatmapCalendar } from "@/components/charts/HeatmapCalendar";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { LoadingDataset } from "@/components/LoadingDataset";
import { PageSkeleton } from "@/components/PageSkeleton";
import { RangeLabel, TimeFilterToolbar } from "@/components/TimeFilterToolbar";
import { SERIES_COLORS } from "@/lib/palette";
import { useDatasetStore } from "@/state/dataset";
import { resolveRange, useFilterStore } from "@/state/filters";
import { useAnalytics } from "@/state/useAnalytics";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const ACCENT = SERIES_COLORS[1] ?? "#d95926";

export default function VideoView() {
	const status = useDatasetStore((s) => s.status);
	const meta = useDatasetStore((s) => s.meta);
	const reload = useDatasetStore((s) => s.reload);
	const filterState = useFilterStore();

	useEffect(() => {
		if (status === "idle") reload();
	}, [status, reload]);

	const { range, label } = useMemo(
		() =>
			resolveRange(filterState, meta?.minTs ?? 0, meta?.maxTs ?? Date.now()),
		[filterState, meta],
	);
	// Depend on the range's two primitives, not the `range` object - see the note
	// in MusicView. Do NOT narrow the deps of the memo above: `resolveRange` calls
	// `Date.now()`, so keying it on from/to would freeze the relative presets.
	const { from, to } = range;
	const trendBucket = autoBucket(from, to);

	const ready = status === "ready" && meta !== null;
	const request = useMemo<RequestFor<"videoDashboard"> | null>(
		() =>
			ready
				? { name: "videoDashboard", range: { from, to }, bucket: trendBucket }
				: null,
		[ready, from, to, trendBucket],
	);
	const dashboard = useAnalytics(request);

	// Presentation-only derivations of the histograms. They read 24 and 7 numbers
	// respectively, so they belong on this thread rather than in the request.
	const hourData = useMemo(() => {
		const hours = dashboard.data?.hours;
		if (!hours) return [];
		const peak = hours.indexOf(Math.max(...hours));
		return hours.map((value, h) => ({
			label: String(h).padStart(2, "0"),
			value,
			color: value > 0 && h === peak ? ACCENT : undefined,
		}));
	}, [dashboard.data]);

	const weekdayData = useMemo(
		() =>
			WEEKDAYS.map((label, i) => ({
				label,
				value: dashboard.data?.weekdays[i] ?? 0,
			})),
		[dashboard.data],
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
	if (dashboard.pending) return <PageSkeleton />;

	const data = dashboard.data;
	if (!data) return <PageSkeleton label="Could not load this page" />;

	return (
		<div className="space-y-6">
			<TimeFilterToolbar years={data.years} />

			{dashboard.error && (
				<p role="alert" className="text-sm text-destructive">
					Could not update these numbers: {dashboard.error}
				</p>
			)}

			<section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Stat
					label="Videos watched"
					value={data.summary.totalPlays.toLocaleString()}
				/>
				<Stat
					label="Channels"
					value={data.summary.uniqueChannels.toLocaleString()}
				/>
				<Stat label="Range" value={label} />
			</section>

			<ChartCard
				title="Top channels"
				subtitle={<RangeLabel dataMin={meta.minTs} dataMax={meta.maxTs} />}
			>
				<ChannelLeaderboard channels={data.channels} />
			</ChartCard>

			<ChartCard
				title="Viewing trend"
				subtitle={
					trendBucket === "month" ? "Views per month" : "Views per year"
				}
			>
				<TrendLineChart
					data={data.trend}
					label={`Viewing trend line chart, views per ${trendBucket}`}
				/>
			</ChartCard>

			<ChartCard
				title="Watch-time calendar"
				subtitle="Streams per day across the whole dataset"
				height={200}
			>
				<HeatmapCalendar calendar={data.calendar} />
			</ChartCard>

			<div className="grid gap-6 lg:grid-cols-2">
				<ChartCard
					title="Peak viewing hours"
					subtitle="Local time of day, peak hour highlighted"
					height={280}
				>
					<BarsChart
						data={hourData}
						label="Bar chart of views by hour of day, 24 bars"
					/>
				</ChartCard>
				<ChartCard
					title="Day of week"
					subtitle="Views per weekday"
					height={280}
				>
					<BarsChart
						data={weekdayData}
						label="Bar chart of views by weekday, 7 bars"
					/>
				</ChartCard>
			</div>
		</div>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}
