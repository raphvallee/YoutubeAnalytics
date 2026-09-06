import { useEffect, useMemo } from "react";
import { Link } from "react-router";
import { autoBucket } from "@/analytics/buckets";
import { availableYears } from "@/analytics/queries";
import {
	hourHistogram,
	topChannels,
	weekdayHistogram,
	youtubeSummary,
	youtubeTrend,
} from "@/analytics/youtube";
import { ChannelLeaderboard } from "@/components/ChannelLeaderboard";
import { ChartCard } from "@/components/ChartCard";
import { BarsChart } from "@/components/charts/BarsChart";
import { TrendLineChart } from "@/components/charts/TrendLineChart";
import { RangeLabel, TimeFilterToolbar } from "@/components/TimeFilterToolbar";
import { SERIES_COLORS } from "@/lib/palette";
import { useDatasetStore } from "@/state/dataset";
import { resolveRange, useFilterStore } from "@/state/filters";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const ACCENT = SERIES_COLORS[1] ?? "#d95926";

export default function OverviewView() {
	const { status, records, meta, reload } = useDatasetStore();
	const filterState = useFilterStore();

	useEffect(() => {
		if (status === "idle") reload();
	}, [status, reload]);

	const { range, label } = useMemo(
		() =>
			resolveRange(filterState, meta?.minTs ?? 0, meta?.maxTs ?? Date.now()),
		[filterState, meta],
	);

	const years = useMemo(() => availableYears(records), [records]);
	const summary = useMemo(
		() => youtubeSummary(records, range),
		[records, range],
	);
	const channels = useMemo(
		() => topChannels(records, range, {}, 25),
		[records, range],
	);
	const hours = useMemo(() => hourHistogram(records, range), [records, range]);
	const weekdays = useMemo(
		() => weekdayHistogram(records, range),
		[records, range],
	);
	const trendBucket = autoBucket(range.from, range.to);
	const trend = useMemo(
		() => youtubeTrend(records, range, trendBucket),
		[records, range, trendBucket],
	);

	const hourData = useMemo(() => {
		const peak = hours.indexOf(Math.max(...hours));
		return hours.map((value, h) => ({
			label: String(h).padStart(2, "0"),
			value,
			color: value > 0 && h === peak ? ACCENT : undefined,
		}));
	}, [hours]);

	const weekdayData = useMemo(
		() => WEEKDAYS.map((label, i) => ({ label, value: weekdays[i] ?? 0 })),
		[weekdays],
	);

	if (status !== "ready") {
		return (
			<p className="p-6 text-sm text-muted-foreground">Loading dataset…</p>
		);
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

			<section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Stat
					label="Videos watched"
					value={summary.totalPlays.toLocaleString()}
				/>
				<Stat
					label="Channels"
					value={summary.uniqueChannels.toLocaleString()}
				/>
				<Stat label="Range" value={label} />
			</section>

			<ChartCard
				title="Top channels"
				subtitle={<RangeLabel dataMin={meta.minTs} dataMax={meta.maxTs} />}
			>
				<ChannelLeaderboard channels={channels} />
			</ChartCard>

			<ChartCard
				title="Viewing trend"
				subtitle={
					trendBucket === "month" ? "Views per month" : "Views per year"
				}
			>
				<TrendLineChart data={trend} />
			</ChartCard>

			<div className="grid gap-6 lg:grid-cols-2">
				<ChartCard
					title="Peak viewing hours"
					subtitle="Local time of day, peak hour highlighted"
					height={280}
				>
					<BarsChart data={hourData} />
				</ChartCard>
				<ChartCard
					title="Day of week"
					subtitle="Views per weekday"
					height={280}
				>
					<BarsChart data={weekdayData} />
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
