/**
 * Watch-time heatmap calendar (Phase 6) - day-level play counts laid out as
 * GitHub-style month columns (Mon-first weeks). Pure: no React, no DB.
 */
import type { StreamRecord } from "@/db/types";
import { inRange, type QueryOptions } from "./queries";

/** Local-midnight instant of the day containing `ts`. */
export function dayStart(ts: number): number {
	const d = new Date(ts);
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Plays per local day (organic rows only, unless includeAds). */
export function dayCounts(
	records: StreamRecord[],
	opts: QueryOptions = {},
): Map<number, number> {
	const counts = new Map<number, number>();
	for (const r of records) {
		if (
			!inRange(
				r,
				{ from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY },
				opts,
			)
		)
			continue;
		const day = dayStart(r.ts);
		counts.set(day, (counts.get(day) ?? 0) + 1);
	}
	return counts;
}

export interface HeatCell {
	/** Local-midnight ts. */
	day: number;
	count: number;
	/** 0 = no activity, 1..4 = intensity quartiles of the active days. */
	level: 0 | 1 | 2 | 3 | 4;
}

export interface HeatMonth {
	/** 'YYYY-MM'. */
	key: string;
	label: string;
	/** Empty leading cells (Mon-first offset of the 1st). */
	offset: number;
	days: HeatCell[];
}

export interface Calendar {
	months: HeatMonth[];
	total: number;
	activeDays: number;
	/** Highest single-day count. */
	max: number;
}

const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** Intensity thresholds: quartiles of the positive day counts. */
export function levelThresholds(
	counts: number[],
): [number, number, number, number] {
	const positive = counts.filter((c) => c > 0).sort((a, b) => a - b);
	if (positive.length === 0) return [1, 1, 1, 1];
	const q = (p: number): number =>
		positive[Math.min(positive.length - 1, Math.floor(p * positive.length))] ??
		1;
	return [q(0.25), q(0.5), q(0.75), q(0.9)];
}

function levelOf(
	count: number,
	thresholds: [number, number, number, number],
): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0) return 0;
	if (count <= thresholds[0]) return 1;
	if (count <= thresholds[1]) return 2;
	if (count <= thresholds[2]) return 3;
	return 4;
}

/**
 * Month-column calendar covering every month from the first to the last day
 * with activity (single-month data yields one column). Levels are quartiles
 * of the positive counts so the ramp stays meaningful at any scale.
 */
export function buildCalendar(
	records: StreamRecord[],
	opts: QueryOptions = {},
): Calendar {
	const counts = dayCounts(records, opts);
	if (counts.size === 0) {
		return { months: [], total: 0, activeDays: 0, max: 0 };
	}

	const days = [...counts.keys()].sort((a, b) => a - b);
	const first = days[0];
	const last = days[days.length - 1];
	if (first === undefined || last === undefined) {
		return { months: [], total: 0, activeDays: 0, max: 0 };
	}

	const thresholds = levelThresholds([...counts.values()]);
	const months: HeatMonth[] = [];
	let cursor = new Date(first);
	cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	const endMonth = new Date(
		new Date(last).getFullYear(),
		new Date(last).getMonth(),
		1,
	);

	while (cursor <= endMonth) {
		const y = cursor.getFullYear();
		const m = cursor.getMonth();
		const monthDays: HeatCell[] = [];
		const dim = new Date(y, m + 1, 0).getDate();
		for (let d = 1; d <= dim; d++) {
			const day = new Date(y, m, d).getTime();
			const count = counts.get(day) ?? 0;
			monthDays.push({ day, count, level: levelOf(count, thresholds) });
		}
		months.push({
			key: `${y}-${String(m + 1).padStart(2, "0")}`,
			label: MONTH_LABELS[m] ?? "",
			offset: (new Date(y, m, 1).getDay() + 6) % 7, // Mon-first
			days: monthDays,
		});
		cursor = new Date(y, m + 1, 1);
	}

	let total = 0;
	for (const c of counts.values()) total += c;
	return {
		months,
		total,
		activeDays: counts.size,
		max: Math.max(...counts.values()),
	};
}
