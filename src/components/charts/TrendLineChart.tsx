import { useMemo } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip as ReTooltip,
	XAxis,
	YAxis,
} from "recharts";
import { OTHER_COLOR, SERIES_COLORS } from "@/lib/palette";

const AXIS_STYLE = { fontSize: 11, fill: "#898781" } as const;
const BLUE = SERIES_COLORS[0] ?? "#3987e5";

/** Single-series monthly trend line. Zero months render as gaps to zero. */
export function TrendLineChart({
	data,
	compareData,
	label,
}: {
	data: Array<{ key: string; plays: number }>;
	/** Optional snapshot series to overlay (Phase 6 compare). */
	compareData?: Array<{ key: string; plays: number }>;
	/** Accessible description of what the line measures. */
	label?: string;
}) {
	const rows = useMemo<
		Array<{ key: string; plays: number; snapshot?: number }>
	>(() => {
		if (!compareData) return data.map((d) => ({ ...d }));
		const snap = new Map(compareData.map((d) => [d.key, d.plays]));
		return data.map((d) => ({
			...d,
			snapshot: snap.get(d.key) ?? 0,
		}));
	}, [data, compareData]);

	return (
		<div className="flex h-full flex-col">
			<div
				className="min-h-0 flex-1"
				role="img"
				aria-label={label ?? `Trend line chart, ${data.length} periods`}
			>
				<ResponsiveContainer width="100%" height="100%">
					<LineChart
						data={rows}
						margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
					>
						<CartesianGrid stroke="#2c2c2a" vertical={false} />
						<XAxis
							dataKey="key"
							tick={AXIS_STYLE}
							tickLine={false}
							axisLine={{ stroke: "#383835" }}
							minTickGap={28}
						/>
						<YAxis
							tick={AXIS_STYLE}
							tickLine={false}
							axisLine={false}
							allowDecimals={false}
						/>
						<ReTooltip
							content={({ active, payload, label }) => {
								if (
									!active ||
									!payload?.length ||
									typeof payload[0]?.value !== "number"
								)
									return null;
								const v = payload[0].value as number;
								return (
									<div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
										<span className="text-muted-foreground">{label}: </span>
										<span className="font-mono tabular-nums">
											{v.toLocaleString()}
										</span>
									</div>
								);
							}}
						/>
						<Line
							type="monotone"
							dataKey="plays"
							name="Views"
							stroke={BLUE}
							strokeWidth={2}
							dot={data.length <= 24 ? { r: 2, fill: BLUE } : false}
						/>
						{compareData && (
							<Line
								type="monotone"
								dataKey="snapshot"
								name="Snapshot"
								stroke={OTHER_COLOR}
								strokeWidth={2}
								strokeDasharray="4 3"
								dot={data.length <= 24 ? { r: 2, fill: OTHER_COLOR } : false}
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			</div>
			{compareData && (
				<div className="mt-2 flex items-center justify-end gap-4 text-xs text-muted-foreground">
					<span className="flex items-center gap-1.5">
						<span
							className="inline-block h-0.5 w-4"
							style={{ background: BLUE }}
						/>
						Current
					</span>
					<span className="flex items-center gap-1.5">
						<span
							className="inline-block h-0.5 w-4"
							style={{
								background: `repeating-linear-gradient(90deg, ${OTHER_COLOR} 0 4px, transparent 4px 7px)`,
							}}
						/>
						Snapshot
					</span>
				</div>
			)}
		</div>
	);
}
