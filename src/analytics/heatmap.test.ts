import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import { buildCalendar, dayCounts, dayStart, levelThresholds } from "./heatmap";

function rec(ts: number, kind: "music" | "youtube" = "youtube"): StreamRecord {
	return {
		id: `${ts}-${kind}`,
		ts,
		kind,
		videoId: "vid",
		title: "T",
		rawTitle: "T",
		artist: null,
		artistKey: "",
		artistConfidence: "unknown",
		channel: null,
		channelId: null,
		adDriven: false,
	};
}

describe("dayCounts", () => {
	it("buckets rows onto local midnight, organic only by default", () => {
		const noon = new Date(2024, 2, 3, 12, 30).getTime();
		const counts = dayCounts([
			rec(noon),
			rec(noon + 60_000),
			rec(noon, "music"),
			rec(noon, "youtube"),
		]);
		counts.forEach((c) => {
			expect(c).toBe(4);
			expect(new Date([...counts.keys()][0] ?? 0).getHours()).toBe(0);
		});
	});

	it("includes ad-driven rows when includeAds is set", () => {
		const ad = (ts: number): StreamRecord => ({ ...rec(ts), adDriven: true });
		const noon = new Date(2024, 2, 3, 12).getTime();
		const rows = [rec(noon), ad(noon), ad(noon + 3_600_000)];
		expect([...dayCounts(rows).values()]).toEqual([1]);
		expect([...dayCounts(rows, { includeAds: true }).values()]).toEqual([3]);
	});

	it("keeps 23h/25h DST days on one local day", () => {
		// 2024-03-10 is the US/EU spring-forward date; 2024-10-27 the EU/US
		// fall-back one. Whether the runner's zone actually shifts on them, the
		// invariants below must hold either way.
		for (const [y, m, d] of [
			[2024, 2, 10],
			[2024, 10, 6],
			[2024, 10, 27],
			[2024, 8, 8], // Chile shifts at local midnight
			[2024, 2, 29], // leap day
			[2024, 11, 31], // year boundary
			[2025, 0, 1],
		] as const) {
			const starts = new Set<number>();
			const rows: StreamRecord[] = [];
			for (let h = 0; h < 24; h++) {
				const ts = new Date(y, m, d, h, 30).getTime();
				const start = dayStart(ts);
				const s = new Date(start);
				const t = new Date(ts);
				expect([s.getFullYear(), s.getMonth(), s.getDate()]).toEqual([
					t.getFullYear(),
					t.getMonth(),
					t.getDate(),
				]);
				expect(start).toBeLessThanOrEqual(ts);
				// Local, not UTC: local midnight differs from the UTC-day bucket
				// exactly when the zone is offset from UTC.
				if (t.getTimezoneOffset() !== 0) {
					expect(start).not.toBe(Math.floor(ts / 86_400_000) * 86_400_000);
				}
				starts.add(start);
				rows.push(rec(ts));
			}
			expect(starts.size).toBe(1);
			expect(dayCounts(rows).size).toBe(1);
			// The month grid keys must still line up with the dayCounts keys.
			const grid = new Set(
				buildCalendar(rows).months.flatMap((mm) => mm.days.map((dd) => dd.day)),
			);
			expect(grid.has([...starts][0] ?? 0)).toBe(true);
		}
	});

	it("separates adjacent local days across a transition", () => {
		const rows = [
			rec(new Date(2024, 2, 9, 23, 30).getTime()),
			rec(new Date(2024, 2, 10, 0, 30).getTime()),
			rec(new Date(2024, 2, 10, 23, 30).getTime()),
			rec(new Date(2024, 2, 11, 0, 30).getTime()),
		];
		const counts = dayCounts(rows);
		expect(counts.size).toBe(3);
		expect([...counts.values()].sort((a, b) => b - a)).toEqual([2, 1, 1]);
	});
});

describe("dayStart", () => {
	it("returns the first instant of the local day containing ts", () => {
		const ts = new Date(2024, 5, 9, 23, 59, 59, 999).getTime();
		const start = dayStart(ts);
		expect(new Date(start).getHours()).toBe(0);
		expect(new Date(start).getDate()).toBe(9);
		expect(start).toBeLessThan(ts);
		// Nothing earlier on the same local day maps anywhere else.
		expect(dayStart(start)).toBe(start);
	});
});

describe("levelThresholds", () => {
	it("returns quartiles of positive counts", () => {
		const [a, b, c, d] = levelThresholds([0, 2, 4, 6, 8, 10, 12, 14]);
		expect([a, b, c, d]).toEqual([4, 8, 12, 14]);
	});
	it("degenerates to 1s without data", () => {
		expect(levelThresholds([])).toEqual([1, 1, 1, 1]);
	});
});

describe("buildCalendar", () => {
	it("produces contiguous months with Mon-first offsets and levels", () => {
		// Two days in different months, plus a heavy day for level spread.
		const d1 = new Date(2024, 0, 15).getTime(); // Jan 2024
		const d2 = new Date(2024, 1, 3).getTime(); // Feb 2024
		const calendar = buildCalendar([
			rec(d1),
			rec(d1),
			rec(d2, "music"),
			...Array.from({ length: 10 }, (_, i) =>
				rec(new Date(2024, 1, 4, i).getTime()),
			),
		]);
		expect(calendar.months.map((m) => m.key)).toEqual(["2024-01", "2024-02"]);
		const jan = calendar.months[0];
		const feb = calendar.months[1];
		expect(jan?.days).toHaveLength(31);
		expect(feb?.days).toHaveLength(29); // 2024 leap year
		const first = new Date(2024, 0, 1).getDay(); // Monday = 1
		expect(jan?.offset).toBe((first + 6) % 7);

		// Levels: Jan day (2 plays) is a low level; the 10-play day is the max.
		const jan15 = jan?.days[14];
		const feb4 = feb?.days[3];
		expect(jan15?.count).toBe(2);
		expect(feb4?.count).toBe(10);
		expect(feb4?.level ?? 0).toBeGreaterThan(jan15?.level ?? 0);
		expect(calendar.max).toBe(10);
		expect(calendar.total).toBe(13);
		expect(calendar.activeDays).toBe(3);
	});

	it("returns an empty calendar without records", () => {
		expect(buildCalendar([])).toEqual({
			months: [],
			total: 0,
			activeDays: 0,
			max: 0,
		});
	});

	it("dayStart is idempotent across hours of one day", () => {
		const a = dayStart(new Date(2025, 5, 9, 0, 1).getTime());
		const b = dayStart(new Date(2025, 5, 9, 23, 59).getTime());
		expect(a).toBe(b);
	});
});
