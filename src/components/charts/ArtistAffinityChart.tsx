import {
	Area,
	AreaChart,
	Brush,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip as ReTooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { SeriesPoint } from "@/analytics/queries";
import { ChartTooltip } from "./ChartTooltip";

const AXIS_STYLE = { fontSize: 11, fill: "#898781" } as const;

/** Single-artist play frequency per bucket, gap-filled with zeros - §3.3. */
export function ArtistAffinityChart({ points }: { points: SeriesPoint[] }) {
	return (
		<div
			className="h-full"
			role="img"
			aria-label={`Play frequency area chart, ${points.length} buckets`}
		>
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart
					data={points}
					margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
				>
					<defs>
						<linearGradient id="affinityFill" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor="#3987e5" stopOpacity={0.35} />
							<stop offset="100%" stopColor="#3987e5" stopOpacity={0.03} />
						</linearGradient>
					</defs>
					<CartesianGrid stroke="#2c2c2a" vertical={false} />
					<XAxis
						dataKey="key"
						tick={AXIS_STYLE}
						tickLine={false}
						axisLine={{ stroke: "#383835" }}
						minTickGap={24}
					/>
					<YAxis
						tick={AXIS_STYLE}
						tickLine={false}
						axisLine={false}
						allowDecimals={false}
					/>
					<ReTooltip content={<ChartTooltip />} />
					<Area
						type="monotone"
						dataKey="plays"
						name="Plays"
						stroke="#3987e5"
						strokeWidth={2}
						fill="url(#affinityFill)"
					/>
					{points.length >= 12 && (
						<Brush
							dataKey="key"
							height={20}
							stroke="#383835"
							travellerWidth={8}
						/>
					)}
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}
