import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip as ReTooltip,
	XAxis,
	YAxis,
} from "recharts";
import { SERIES_COLORS } from "@/lib/palette";

const AXIS_STYLE = { fontSize: 11, fill: "#898781" } as const;
const BLUE = SERIES_COLORS[0] ?? "#3987e5";

/** Single-series monthly trend line. Zero months render as gaps to zero. */
export function TrendLineChart({
	data,
}: {
	data: Array<{ key: string; plays: number }>;
}) {
	return (
		<ResponsiveContainer width="100%" height="100%">
			<LineChart
				data={data}
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
			</LineChart>
		</ResponsiveContainer>
	);
}
