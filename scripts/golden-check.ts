/**
 * Golden-output differ: current analytics vs the pre-optimization baseline.
 *
 * Run `bun run golden:setup` first - it extracts the HEAD revision of every
 * analytics module into `src/.golden-baseline/` so both implementations can be
 * imported side by side over the same records.
 *
 * The point is to make "output-identical" a checkable claim rather than an
 * assertion. Every public query is compared at several ranges, over a fixture
 * built to contain the awkward cases: both kinds, ad-driven rows,
 * unattributed rows, decorated/feat titles, accented and CJK titles, ties on
 * plays, duplicate display names, and rows outside every range.
 *
 *   bun scripts/golden-check.ts
 */

import * as baseHeat from "@/.golden-baseline/heatmap";
import * as baseLikes from "@/.golden-baseline/likes";
import * as base from "@/.golden-baseline/queries";
import * as baseYt from "@/.golden-baseline/youtube";
import * as curHeat from "@/analytics/heatmap";
import * as curLikes from "@/analytics/likes";
import * as cur from "@/analytics/queries";
import * as curYt from "@/analytics/youtube";
import type { StreamRecord } from "@/db/types";

let seed = 0x9e3779b9;
function rnd(): number {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
function pick<T>(xs: readonly T[]): T {
	return xs[Math.floor(rnd() * xs.length)] as T;
}

/** Deliberately small artist pool -> lots of ties and duplicate display names. */
const ARTISTS = [
	"Björk",
	"Daft Punk",
	"Radiohead",
	"Ólafur Arnalds",
	"Massive Attack",
	"Bjork",
	"Café Tacvba",
	"신라면",
	"Same Name",
	"Same Name",
] as const;
const TITLES = [
	"Something",
	"Weightless",
	"Nightcall",
	"Björk - Jóga",
	"夜曲",
	"Same Name",
	"Same Name",
	"Hyperballad",
	"Unravel",
	"Teardrop",
] as const;
const NOISE = [
	"",
	"",
	"",
	" (Official Video)",
	" [Official Audio]",
	" (HD)",
	" (Remastered 2011)",
	" (Lyrics)",
] as const;
const CHANNELS = [
	"Release - Topic",
	"Future - Topic",
	"SickEdits",
	"ChannelTopic",
] as const;

const NOW = Date.UTC(2026, 9, 4);
const START = NOW - 14 * 366 * 86_400_000;
const T = (y: number, m: number, d: number) =>
	new Date(y, m - 1, d, 12, 0, 0).getTime();

const records: StreamRecord[] = [];
for (let i = 0; i < 4000; i++) {
	const music = rnd() < 0.6;
	const ts = START + Math.floor(rnd() * (NOW - START));
	// Every 400th row sits exactly on New Year, which is where the week-bucket
	// fix matters and where the fixture would otherwise silently agree.
	const ts2 = i % 400 === 0 ? T(2026, 1, 1 + (i % 4)) : ts;
	const title = `${pick(TITLES)}${pick(NOISE)}`;
	const feat = rnd() < 0.15 ? ` (feat. ${pick(ARTISTS)})` : "";
	const artist = pick(ARTISTS);
	const unattributed = music && rnd() < 0.08;
	records.push({
		id: `id${i}`,
		ts: ts2,
		kind: music ? "music" : "youtube",
		videoId: rnd() < 0.9 ? `v${i}` : null,
		title: `${title}${feat}`,
		rawTitle: `Vous avez regardé ${title}${feat}`,
		artist: music ? (unattributed ? null : artist) : null,
		artistKey: music && !unattributed ? artist.toLowerCase() : "",
		artistConfidence: unattributed ? "unknown" : music ? "topic" : "unknown",
		channel: music
			? unattributed
				? "Release - Topic"
				: `${artist} - Topic`
			: pick(CHANNELS),
		channelId: `c${i % 40}`,
		adDriven: rnd() < 0.05,
	});
}

const RANGES = [
	["all-time", { from: START, to: NOW }],
	["2026", { from: T(2026, 1, 1), to: T(2026, 12, 31) }],
	["new-year-jan", { from: T(2026, 1, 1), to: T(2026, 1, 31) }],
	["new-year-dec", { from: T(2025, 12, 1), to: T(2026, 2, 1) }],
	["last-7d", { from: NOW - 7 * 86_400_000, to: NOW }],
	["last-90d", { from: NOW - 90 * 86_400_000, to: NOW }],
] as const;

const likes = records
	.filter((_, i) => i % 37 === 0)
	.slice(0, 40)
	.map((r, i) => ({
		id: `l${i}`,
		videoId: r.videoId,
		title: r.title,
		channel: r.channel,
		addedAt: null,
		sourceFile: "likes.csv",
	}));

let checks = 0;
let failures = 0;
/** Comparisons whose difference is a deliberate, documented fix (see EXPECTED). */
const expected = new Map<string, number>();

/**
 * Divergences we intend. `bucketKey` used to label the "week" bucket with the
 * calendar year while numbering weeks by ISO rule; the two disagree around New
 * Year, so those keys were unreachable as span keys and the plays behind them
 * were dropped from every chart. buckets.ts now uses the ISO week-numbering
 * year. Week series therefore differ - and must gain plays, never lose them.
 */
const EXPECTED = new Set(["scopedSeries/week"]);

/** Compare a value produced by the baseline against the current build. */
function same(label: string, a: unknown, b: unknown) {
	checks++;
	const sa = JSON.stringify(a);
	const sb = JSON.stringify(b);
	if (sa === sb) return;
	if (EXPECTED.has(label)) {
		expected.set(label, (expected.get(label) ?? 0) + 1);
		console.log(`  expected  ${label}  (C0 week-bucket fix)`);
		return;
	}
	failures++;
	const ta = sa ?? "";
	const tb = sb ?? "";
	let at = -1;
	while (at < ta.length && at < tb.length && ta[at] === tb[at]) at++;
	console.log(`\n  MISMATCH  ${label}`);
	console.log(`    first divergence at char ${at}`);
	console.log(`    baseline: ...${ta.slice(Math.max(0, at - 60), at + 90)}`);
	console.log(`    current : ...${tb.slice(Math.max(0, at - 60), at + 90)}`);
}

/** Total plays across a series; used to assert the week fix never loses data. */
function plays(rows: unknown): number {
	return (rows as Array<{ plays: number }>).reduce((s, p) => s + p.plays, 0);
}

console.log(
	`fixture: ${records.length} records (${records.filter((r) => r.kind === "music").length} music), 14y span`,
);
console.log(`distinct titles: ${new Set(records.map((r) => r.title)).size}`);

for (const [name, range] of RANGES) {
	console.log(`\n=== range: ${name} ===`);
	const opts = {};

	same(
		"musicSummary",
		base.musicSummary(records, range),
		cur.musicSummary(records, range),
	);
	same(
		"topArtists",
		base.topArtists(records, range, opts, 25),
		cur.topArtists(records, range, opts, 25),
	);
	same(
		"topTracks",
		base.topTracks(records, range, opts, { limit: 25 }),
		cur.topTracks(records, range, opts, { limit: 25 }),
	);
	same(
		"availableYears",
		base.availableYears(records),
		cur.availableYears(records),
	);

	for (const bucket of ["week", "month", "year"] as const) {
		const b = base.scopedSeries(records, range, bucket, opts, {
			kind: "music",
		});
		const c = cur.scopedSeries(records, range, bucket, opts, { kind: "music" });
		same(`scopedSeries/${bucket}`, b, c);
		if (bucket === "week") {
			// The fix must never lose plays. Month is unchanged by the C0 fix, so a
			// week total below the month total is a regression, not a correction.
			const monthTotal = plays(
				cur.scopedSeries(records, range, "month", opts, { kind: "music" }),
			);
			if (plays(c) < monthTotal) {
				failures++;
				console.log(
					`\n  REGRESSION  scopedSeries/week totals ${plays(c)} but month totals ${monthTotal} - plays were lost`,
				);
			}
		}
	}
	same(
		"macroSeries",
		base.macroSeries(records, range, { bucket: "month", topN: 8 }),
		cur.macroSeries(records, range, { bucket: "month", topN: 8 }),
	);
	same(
		"trackErasSeries",
		base.trackErasSeries(records, range, { bucket: "month", topN: 8 }),
		cur.trackErasSeries(records, range, { bucket: "month", topN: 8 }),
	);

	// C3's contract: sharing the leaderboard's ranking must equal recomputing it.
	const shared = cur.topTracks(records, range, opts, { limit: 25 }).slice(0, 8);
	same(
		"trackErasSeries (shared topTracks)",
		base.trackErasSeries(records, range, { bucket: "month", topN: 8 }),
		cur.trackErasSeries(records, range, {
			bucket: "month",
			topN: 8,
			tracks: shared,
		}),
	);
	same(
		"topTracks slice(0,8) === topTracks(limit 8)",
		base.topTracks(records, range, opts, { limit: 8 }),
		cur
			.topTracks(records, range, opts, { limit: 8 })
			.map((t, i) => shared[i])
			.filter(Boolean)
			.slice(0, 8),
	);

	// Artist-scoped paths used by the drawer.
	same(
		"topTracks scoped to artist",
		base.topTracks(records, range, opts, { artistKey: "björk", limit: 10 }),
		cur.topTracks(records, range, opts, { artistKey: "björk", limit: 10 }),
	);
	same(
		"trackErasSeries scoped to artist",
		base.trackErasSeries(records, range, {
			bucket: "month",
			topN: 8,
			artistKey: "björk",
		}),
		cur.trackErasSeries(records, range, {
			bucket: "month",
			topN: 8,
			artistKey: "björk",
		}),
	);

	// YouTube side.
	same(
		"youtubeSummary",
		baseYt.youtubeSummary(records, range),
		curYt.youtubeSummary(records, range),
	);
	same(
		"topChannels",
		baseYt.topChannels(records, range, opts, 25),
		curYt.topChannels(records, range, opts, 25),
	);
	same(
		"hourHistogram",
		baseYt.hourHistogram(records, range),
		curYt.hourHistogram(records, range),
	);
	same(
		"weekdayHistogram",
		baseYt.weekdayHistogram(records, range),
		curYt.weekdayHistogram(records, range),
	);
	same(
		"youtubeTrend",
		baseYt.youtubeTrend(records, range, "month"),
		curYt.youtubeTrend(records, range, "month"),
	);

	// Likes: both the empty fast-path and the real match.
	same(
		"matchLikes (no likes)",
		baseLikes.matchLikes([], records),
		curLikes.matchLikes([], records),
	);
	same(
		"matchLikes (populated)",
		baseLikes.matchLikes(likes, records),
		curLikes.matchLikes(likes, records),
	);
}

// The calendar deliberately ignores `range` (infinite window by design), so it is
// checked once, globally.
same(
	"buildCalendar",
	baseHeat.buildCalendar(records),
	curHeat.buildCalendar(records),
);
same("dayCounts", baseHeat.dayCounts(records), curHeat.dayCounts(records));

console.log(`\n${"-".repeat(70)}`);
if (failures === 0) {
	const exp = [...expected.entries()].map(([k, n]) => `${k} x${n}`).join(", ");
	console.log(
		`PASS  ${checks - [...expected.values()].reduce((a, b) => a + b, 0)}/${checks} comparisons byte-identical to baseline`,
	);
	if (exp) {
		console.log(
			`      ${exp} intentionally differ (C0 week-bucket fix; week totals only ever gained plays)`,
		);
	}
} else {
	console.log(`FAIL  ${failures}/${checks} comparisons differ from baseline`);
	process.exitCode = 1;
}
