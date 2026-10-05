/**
 * Watch-time heatmap calendar (Phase 6) - day-level play counts laid out as
 * GitHub-style month columns (Mon-first weeks). Pure: no React, no DB.
 */
import type { StreamRecord } from "@/db/types";
import { inRange, type QueryOptions, type Range } from "./queries";

const DAY_MS = 86_400_000;

/** `dayCounts` buckets the whole dataset, so it never clips by timestamp. */
const ALL_TIME: Range = {
	from: Number.NEGATIVE_INFINITY,
	to: Number.POSITIVE_INFINITY,
};

/**
 * Whole local days since the epoch, from `d`'s own local calendar. The local
 * wall clock of `ts` is `ts - offset`, so flooring it into 24h blocks gives the
 * local day ordinal - local, DST-proof and UTC-ordinal-preserving, unlike
 * `Math.floor(ts / DAY_MS)`.
 */
function localDayOrdinal(ts: number, d: Date): number {
	return Math.floor((ts - d.getTimezoneOffset() * 60_000) / DAY_MS);
}

/**
 * Local-midnight instant of the day containing `ts`.
 *
 * One `Date` per call: subtracting this Date's own elapsed local time lands on
 * local midnight, unless a DST transition inside the day stretched or shrank
 * it to 23h/25h. Re-reading the same `Date` at the candidate detects that, and
 * such transition days (a handful per year) fall back to the calendar.
 */
export function dayStart(ts: number): number {
	const d = new Date(ts);
	const y = d.getFullYear();
	const m = d.getMonth();
	const day = d.getDate();
	const midnight =
		ts -
		((d.getHours() * 60 + d.getMinutes()) * 60_000 +
			d.getSeconds() * 1_000 +
			d.getMilliseconds());
	d.setTime(midnight);
	// Local midnight iff that instant reads back as the same day at 00:00:00.000.
	if (
		d.getFullYear() !== y ||
		d.getMonth() !== m ||
		d.getDate() !== day ||
		d.getHours() !== 0 ||
		d.getMinutes() !== 0 ||
		d.getSeconds() !== 0 ||
		d.getMilliseconds() !== 0
	) {
		return new Date(y, m, day).getTime();
	}
	return midnight;
}

/** Plays per local day (organic rows only, unless includeAds). */
export function dayCounts(
	records: StreamRecord[],
	opts: QueryOptions = {},
): Map<number, number> {
	const counts = new Map<number, number>();
	// Local day ordinal -> local midnight, memoized for this call only. Rows
	// arrive unordered, but a whole history spans few distinct days, so the
	// per-row work is one Date + one Map hit instead of two Dates.
	const midnightOf = new Map<number, number>();
	for (const r of records) {
		if (!inRange(r, ALL_TIME, opts)) continue;
		const d = new Date(r.ts);
		const ordinal = localDayOrdinal(r.ts, d);
		let day = midnightOf.get(ordinal);
		if (day === undefined) {
			day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
			midnightOf.set(ordinal, day);
		}
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
