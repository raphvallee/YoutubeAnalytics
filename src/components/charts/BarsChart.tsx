import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ResponsiveContainer,
	Tooltip as ReTooltip,
	XAxis,
	YAxis,
} from "recharts";
import { OTHER_COLOR, SERIES_COLORS } from "@/lib/palette";

const AXIS_STYLE = { fontSize: 11, fill: "#898781" } as const;
const BLUE = SERIES_COLORS[0] ?? OTHER_COLOR;

export interface BarDatum {
	label: string;
	value: number;
	/** Optional highlight color for a specific bar (e.g. peak hour). */
	color?: string;
}

/**
 * Single-series categorical bar chart (hours, weekdays). One hue; a peak bar
 * may take the accent slot. No legend (single series) — BLUEPRINT §4.4.
 */
export function BarsChart({
	data,
	label,
}: {
	data: BarDatum[];
	/** Accessible description of what the bars measure. */
	label?: string;
}) {
	return (
		<div
			className="h-full"
			role="img"
			aria-label={label ?? `Bar chart, ${data.length} bars`}
		>
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={data}
					margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
				>
					<CartesianGrid stroke="#2c2c2a" vertical={false} />
					<XAxis
						dataKey="label"
						tick={AXIS_STYLE}
						tickLine={false}
						axisLine={{ stroke: "#383835" }}
					/>
					<YAxis
						tick={AXIS_STYLE}
						tickLine={false}
						axisLine={false}
						allowDecimals={false}
					/>
					<ReTooltip
						cursor={{ fill: "rgba(255,255,255,0.04)" }}
						content={({ active, payload, label }) => {
							if (
								!active ||
								!payload?.length ||
								typeof payload[0]?.value !== "number"
							)
								return null;
							const v = payload[0].value as number;
							if (v === 0) return null;
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
					<Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={28}>
						{data.map((d) => (
							<Cell key={d.label} fill={d.color ?? BLUE} />
						))}
					</Bar>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
