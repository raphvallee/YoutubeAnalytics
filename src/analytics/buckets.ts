import {
	addMonths,
	addWeeks,
	addYears,
	getISOWeek,
	startOfISOWeek,
	startOfMonth,
	startOfYear,
} from "date-fns";

export type Bucket = "week" | "month" | "year";

/** Start instant of the bucket containing `ts` (local timezone). */
export function bucketStart(ts: number, bucket: Bucket): number {
	const d = new Date(ts);
	switch (bucket) {
		case "week":
			return startOfISOWeek(d).getTime();
		case "month":
			return startOfMonth(d).getTime();
		case "year":
			return startOfYear(d).getTime();
	}
}

export function nextBucketStart(ts: number, bucket: Bucket): number {
	const d = new Date(ts);
	switch (bucket) {
		case "week":
			return addWeeks(startOfISOWeek(d), 1).getTime();
		case "month":
			return addMonths(startOfMonth(d), 1).getTime();
		case "year":
			return addYears(startOfYear(d), 1).getTime();
	}
}

/** Stable bucket key: '2026-W36' | '2026-09' | '2026'. */
export function bucketKey(ts: number, bucket: Bucket): string {
	const d = new Date(ts);
	const y = d.getFullYear();
	switch (bucket) {
		case "week": {
			const w = getISOWeek(d);
			return `${y}-W${String(w).padStart(2, "0")}`;
		}
		case "month":
			return `${y}-${String(d.getMonth() + 1).padStart(2, "0")}`;
		case "year":
			return String(y);
	}
}

export interface BucketSpan {
	start: number;
	end: number;
	key: string;
}

/**
 * Full contiguous list of bucket spans covering [from, to) — the gap-filler
 * backbone for time series: series map onto these and missing buckets stay 0.
 */
export function buildBucketSpans(
	from: number,
	to: number,
	bucket: Bucket,
): BucketSpan[] {
	if (to <= from) return [];
	const spans: BucketSpan[] = [];
	let cursor = bucketStart(from, bucket);
	while (cursor < to) {
		const end = nextBucketStart(cursor, bucket);
		spans.push({ start: cursor, end, key: bucketKey(cursor, bucket) });
		cursor = end;
	}
	return spans;
}

/** Pick a readable default granularity for a span. */
export function autoBucket(from: number, to: number): Bucket {
	const days = (to - from) / 86_400_000;
	if (days <= 130) return "week";
	if (days <= 5 * 366) return "month";
	return "year";
}
