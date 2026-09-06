import { format } from "date-fns";
import { useMemo, useState } from "react";
import { buildCalendar, type HeatCell } from "@/analytics/heatmap";
import type { StreamRecord } from "@/db/types";

/**
 * Watch-time heatmap calendar (Phase 6): GitHub-style month columns, Mon-first.
 * Sequential blue ramp (dataviz reference), bright = more; ordinal steps
 * validated on the dark surface (2.15:1 light end). Levels are quartiles of
 * the active days, so the ramp stays meaningful at any dataset scale.
 */

// Steps 600 / 500 / 350 / 250 of the reference blue ramp (dark surface).
const LEVEL_COLORS = ["#184f95", "#256abf", "#5598e7", "#86b6ef"] as const;
const EMPTY_COLOR = "#232322";
const CELL = 11;
const GAP = 3;

const WEEKDAY_LABELS = [
	{ key: "mon", label: "Mon" },
	{ key: "tue", label: "" },
	{ key: "wed", label: "Wed" },
	{ key: "thu", label: "" },
	{ key: "fri", label: "Fri" },
	{ key: "sat", label: "" },
	{ key: "sun", label: "Sun" },
] as const;

const PAD_KEYS = ["p0", "p1", "p2", "p3", "p4", "p5"] as const;

export function HeatmapCalendar({ records }: { records: StreamRecord[] }) {
	const calendar = useMemo(() => buildCalendar(records), [records]);
	const cellsByDay = useMemo(
		() =>
			new Map(calendar.months.flatMap((m) => m.days).map((c) => [c.day, c])),
		[calendar],
	);
	const [hover, setHover] = useState<HeatCell | null>(null);

	return (
		<div className="flex h-full flex-col">
			{calendar.months.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					No streams in range.
				</p>
			) : (
				// biome-ignore lint/a11y/useKeyWithMouseEvents: hover is a decorative layer; the chart exposes role=img with a full text summary
				<div
					className="relative flex min-h-0 flex-1 items-start gap-2 overflow-x-auto pb-1"
					role="img"
					aria-label={`Watch-time calendar: ${calendar.total.toLocaleString()} streams across ${calendar.activeDays.toLocaleString()} active days, busiest day ${calendar.max.toLocaleString()} streams.`}
					onMouseLeave={() => setHover(null)}
					onMouseOver={(e) => {
						const day = (e.target as HTMLElement).dataset?.day;
						setHover(
							day !== undefined ? (cellsByDay.get(Number(day)) ?? null) : null,
						);
					}}
				>
					<div
						className="sticky left-0 shrink-0 bg-background pt-[18px]"
						style={{ width: 30 }}
						aria-hidden="true"
					>
						{WEEKDAY_LABELS.map(({ key, label }) => (
							<div
								key={key}
								style={{ height: CELL + GAP }}
								className="text-[9px] leading-none text-muted-foreground"
							>
								{label}
							</div>
						))}
					</div>
					{calendar.months.map((month) => (
						<div key={month.key} className="shrink-0">
							<div className="mb-1 h-[14px] text-[10px] leading-[14px] text-muted-foreground">
								{month.label}
							</div>
							<div
								className="grid"
								style={{
									gridTemplateRows: `repeat(7, ${CELL}px)`,
									gridAutoFlow: "column",
									gap: GAP,
								}}
							>
								{PAD_KEYS.slice(0, month.offset).map((key) => (
									<div key={key} />
								))}
								{month.days.map((cell) => (
									<div
										key={cell.day}
										data-day={cell.day}
										style={{
											width: CELL,
											height: CELL,
											background:
												cell.level === 0
													? EMPTY_COLOR
													: LEVEL_COLORS[cell.level - 1],
										}}
										className="rounded-[2px]"
									/>
								))}
							</div>
						</div>
					))}
					{hover && (
						<div
							className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
							style={{ left: "50%", bottom: 4, transform: "translateX(-50%)" }}
						>
							{hover.count.toLocaleString()} stream
							{hover.count === 1 ? "" : "s"} ·{" "}
							{format(hover.day, "MMM d, yyyy")}
						</div>
					)}
				</div>
			)}
			<div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
				<span>Less</span>
				{[0, 1, 2, 3, 4].map((level) => (
					<span
						key={level}
						className="inline-block rounded-[2px]"
						style={{
							width: CELL - 2,
							height: CELL - 2,
							background: level === 0 ? EMPTY_COLOR : LEVEL_COLORS[level - 1],
						}}
					/>
				))}
				<span>More</span>
			</div>
		</div>
	);
}
