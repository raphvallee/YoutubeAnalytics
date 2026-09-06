import { useMemo, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip as ReTooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { StackRow } from "@/analytics/queries";
import { OTHER_COLOR, seriesColor } from "@/lib/palette";
import { ChartTooltip } from "./ChartTooltip";

const AXIS_STYLE = { fontSize: 11, fill: "#898781" } as const;

/**
 * Stacked area over time for N series (artists or tracks), 2px surface gaps,
 * colors bound to entities via the persistent registry, Other = gray.
 * `expand` mode = share-of-listening (stackOffset expand).
 * Legend chips hover-isolate a series (dims the others).
 */
export function StackedErasChart({
	rows,
	seriesNames,
	height = 300,
	expand = false,
	label,
}: {
	rows: StackRow[];
	seriesNames: string[];
	height?: number;
	expand?: boolean;
	/** Accessible description; defaults to a summary of the series list. */
	label?: string;
}) {
	const [hovered, setHovered] = useState<string | null>(null);

	const areas = useMemo(
		() =>
			seriesNames.map((name) => ({
				name,
				color: name === "Other" ? OTHER_COLOR : seriesColor(name.toLowerCase()),
			})),
		[seriesNames],
	);

	return (
		<div className="flex h-full flex-col">
			<div
				style={{ height }}
				className="min-h-0"
				role="img"
				aria-label={
					label ??
					`Stacked area chart over time: ${seriesNames.join(", ") || "no series"}${
						expand ? " (share of listening)" : ""
					}`
				}
			>
				<ResponsiveContainer width="100%" height="100%">
					<AreaChart
						data={rows}
						stackOffset={expand ? "expand" : "none"}
						margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
						onMouseLeave={() => setHovered(null)}
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
							allowDecimals={expand}
							tickFormatter={
								expand ? (v: number) => `${Math.round(v * 100)}%` : undefined
							}
						/>
						<ReTooltip
							content={<ChartTooltip totalLabel={expand ? "Share" : "Total"} />}
						/>
						{areas.map(({ name, color }) => (
							<Area
								key={name}
								type="monotone"
								dataKey={name}
								name={name}
								stackId="1"
								stroke={hovered && hovered !== name ? "transparent" : color}
								fill={color}
								fillOpacity={hovered && hovered !== name ? 0.06 : 0.55}
								strokeWidth={hovered === name ? 2.5 : 1}
								animationDuration={250}
							/>
						))}
					</AreaChart>
				</ResponsiveContainer>
			</div>
			{seriesNames.length >= 2 && (
				<ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{seriesNames.map((name) => (
						<li key={name}>
							<button
								type="button"
								className={`flex items-center gap-1.5 transition-colors hover:text-foreground ${
									hovered && hovered !== name ? "opacity-40" : ""
								}`}
								onMouseEnter={() => setHovered(name)}
								onMouseLeave={() => setHovered(null)}
								onFocus={() => setHovered(name)}
								onBlur={() => setHovered(null)}
							>
								<span
									className="inline-block h-2 w-2 rounded-sm"
									style={{
										background:
											name === "Other"
												? OTHER_COLOR
												: seriesColor(name.toLowerCase()),
									}}
								/>
								{name}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
