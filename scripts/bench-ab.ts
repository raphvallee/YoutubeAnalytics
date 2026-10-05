/**
 * Before/after for the exact memo set MusicView and VideoView run on mount,
 * measured by importing the pre-optimization baseline (see golden:setup) beside
 * the current build over one shared 120k-record dataset.
 *
 *   bun scripts/bench-ab.ts [rowCount]
 */

import * as baseHeat from "@/.golden-baseline/heatmap";
import * as baseLikes from "@/.golden-baseline/likes";
import * as base from "@/.golden-baseline/queries";
import * as baseReleases from "@/.golden-baseline/releases";
import * as baseYt from "@/.golden-baseline/youtube";
import * as curHeat from "@/analytics/heatmap";
import * as curLikes from "@/analytics/likes";
import type { Range } from "@/analytics/queries";
import * as cur from "@/analytics/queries";
import * as curYt from "@/analytics/youtube";
import type { StreamRecord } from "@/db/types";

const N = Number(process.argv[2] ?? 120_000);

let seed = 0x2f6e2b1;
function rnd(): number {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
function pick<T>(xs: readonly T[]): T {
	return xs[Math.floor(rnd() * xs.length)] as T;
}

// NOTE on cardinality: this fixture yields ~38k distinct tracks, because the
// title stem and the artistKey are drawn independently, so their cross product
// inflates the distinct count roughly 5x above a real Takeout export. Absolute
// milliseconds are therefore pessimistic. The BEFORE and AFTER columns share one
// dataset, so the comparison between them is still fair - and it is the
// distinct-count-sensitive memos (topTracks, trackErasSeries) that gain the most
// from the memo, so a realistic fixture would show a smaller win, not a larger
// one.
const ARTISTS = [
	"Radiohead",
	"Daft Punk",
	"Kendrick Lamar",
	"Björk",
	"Aphex Twin",
	"Fleetwood Mac",
	"Boards of Canada",
	"Portishead",
	"Massive Attack",
	"Godspeed You! Black Emperor",
	"Sigur Rós",
	"Burial",
	"Autechre",
	"Four Tet",
	"Jamie xx",
	"Beach House",
	"Slowdive",
	"My Bloody Valentine",
	"Cocteau Twins",
	"Talk Talk",
	"Stereolab",
	"Broadcast",
	"Grouper",
	"Tim Hecker",
	"Biosphere",
	"Ólafur Arnalds",
	"Nils Frahm",
	"Hania Rani",
	"Casiopea",
	"Mahavishnu Orchestra",
	"King Crimson",
	"Yes",
	"Genesis",
	"Jean-Michel Jarre",
	"Vangelis",
	"Tangerine Dream",
	"Kraftwerk",
	"Can",
	"Neu!",
	"Faust",
	"Amon Düül II",
	"Kosmische Musik",
	"Miles Davis",
	"John Coltrane",
	"Sun Ra",
	"Alice Coltrane",
	"Pharoah Sanders",
] as const;
const TRACKS = [
	"Something",
	"Weightless",
	"Nightcall",
	"Everything In Its Right Place",
	"Xenithan",
	"Teardrop",
	"Paranoid Android",
	"Fitter Happier",
	"Midnight City",
	"Only Shallow",
	"Glory Box",
	"Angel",
	"Unravel",
	"Rêverie",
	"Avril 14th",
	"Windowlicker",
	"Xtal",
	"Push the Sky Away",
	"Knife Fight",
	"Cirrus",
	"Vespertine",
	"Hyperballad",
	"Hyperbloom",
	"Ritual Union",
	"No Woman No Cry",
	"Svefn-g-englar",
	"Archangel",
	"Weathering",
	"Divenir",
	"Slims",
	"An Ending",
	"Lateralus",
] as const;
const NOISE = [
	"",
	"",
	"",
	"",
	" (Official Video)",
	" [Official Audio]",
	" (HD)",
	" (Remastered 2011)",
	" (Lyrics)",
] as const;

const NOW = Date.UTC(2026, 9, 4);
const START = NOW - 14 * 366 * 86_400_000;

const records: StreamRecord[] = new Array(N);
for (let i = 0; i < N; i++) {
	const music = rnd() < 0.62;
	const ts = START + Math.floor(rnd() * (NOW - START));
	const stem = pick(ARTISTS);
	const noise = pick(NOISE);
	const title = music
		? `${stem} - ${pick(TRACKS)}${rnd() < 0.12 ? ` (feat. ${pick(ARTISTS)})` : ""}${noise}`
		: `${pick(TRACKS)}${noise}`;
	const artist = ARTISTS[Math.floor(rnd() ** 2.2 * ARTISTS.length)] as string;
	const unattributed = music && rnd() < 0.06;
	records[i] = {
		id: `id${i}`,
		ts,
		kind: music ? "music" : "youtube",
		videoId: `v${i}`,
		title,
		rawTitle: `Vous avez regardé ${title}`,
		artist: music ? (unattributed ? null : artist) : null,
		artistKey: music && !unattributed ? artist.toLowerCase() : "",
		artistConfidence: unattributed ? "unknown" : music ? "topic" : "unknown",
		channel: music
			? unattributed
				? "Release - Topic"
				: `${artist} - Topic`
			: "ChannelTopic",
		channelId: `c${i % 900}`,
		adDriven: rnd() < 0.02,
	};
}
const musicCount = records.filter((r) => r.kind === "music").length;

const likes = records
	.filter((_, i) => i % 53 === 0)
	.slice(0, 900)
	.map((r, i) => ({
		id: `l${i}`,
		videoId: r.videoId,
		title: r.title,
		channel: r.channel,
		addedAt: null,
		sourceFile: "likes.csv",
	}));

const range: Range = { from: START, to: NOW };
const year: Range = { from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 11, 31) };

const rows: { name: string; base: number; cur: number }[] = [];

/** Best-of-3 per variant, so JIT warm-up is not billed to either side. */
function time(name: string, b: () => unknown, c: () => unknown) {
	for (let i = 0; i < 3; i++) {
		b();
		c();
	}
	let bt = Number.POSITIVE_INFINITY;
	let ct = Number.POSITIVE_INFINITY;
	for (let i = 0; i < 3; i++) {
		let t = performance.now();
		b();
		bt = Math.min(bt, performance.now() - t);
		t = performance.now();
		c();
		ct = Math.min(ct, performance.now() - t);
	}
	rows.push({ name, base: bt, cur: ct });
}

// ---- MusicView mount memo set ----
const music = () => {
	time(
		"availableYears",
		() => base.availableYears(records),
		() => cur.availableYears(records),
	);
	time(
		"musicSummary",
		() => base.musicSummary(records, range),
		() => cur.musicSummary(records, range),
	);
	time(
		"topArtists",
		() => base.topArtists(records, range, {}, 25),
		() => cur.topArtists(records, range, {}, 25),
	);
	time(
		"topTracks",
		() => base.topTracks(records, range, {}, { limit: 25 }),
		() => cur.topTracks(records, range, {}, { limit: 25 }),
	);
	time(
		"macroSeries",
		() => base.macroSeries(records, range, { bucket: "month", topN: 8 }),
		() => cur.macroSeries(records, range, { bucket: "month", topN: 8 }),
	);
	time(
		"trackErasSeries",
		() => base.trackErasSeries(records, range, { bucket: "month", topN: 8 }),
		() => {
			const shared = cur
				.topTracks(records, range, {}, { limit: 25 })
				.slice(0, 8);
			return cur.trackErasSeries(records, range, {
				bucket: "month",
				topN: 8,
				tracks: shared,
			});
		},
	);
	time(
		"matchLikes (none uploaded)",
		() => baseLikes.matchLikes([], records),
		() => curLikes.matchLikes([], records),
	);
	time(
		"matchLikes (900 uploaded)",
		() => baseLikes.matchLikes(likes, records),
		() => curLikes.matchLikes(likes, records),
	);
	time(
		"scopedSeries/year (compare trend)",
		() => base.scopedSeries(records, range, "year", {}, { kind: "music" }),
		() => cur.scopedSeries(records, range, "year", {}, { kind: "music" }),
	);
	// MusicView no longer calls topReleases at all (with a hardcoded [] it could
	// only ever return []), so there is nothing to A/B - time it once to size the
	// scan that was removed.
	const tr0 = performance.now();
	baseReleases.topReleases(records, [], range);
	rows.push({
		name: "topReleases (call removed)",
		base: performance.now() - tr0,
		cur: 0,
	});
};

// ---- VideoView mount memo set ----
const video = () => {
	time(
		"youtubeSummary",
		() => baseYt.youtubeSummary(records, range),
		() => curYt.youtubeSummary(records, range),
	);
	time(
		"topChannels",
		() => baseYt.topChannels(records, range, {}, 25),
		() => curYt.topChannels(records, range, {}, 25),
	);
	// VideoView now calls the combined pass; the baseline had to make two.
	time(
		"hour + weekday histograms",
		() => [
			baseYt.hourHistogram(records, range),
			baseYt.weekdayHistogram(records, range),
		],
		() => curYt.hourWeekdayHistogram(records, range),
	);
	// Equivalence gate: the combined pass must equal the two separate passes.
	const cb = curYt.hourWeekdayHistogram(records, range);
	const eq =
		JSON.stringify([
			baseYt.hourHistogram(records, range),
			baseYt.weekdayHistogram(records, range),
		]) === JSON.stringify([cb.hours, cb.weekdays]);
	console.log(
		`\nequivalence: hourWeekdayHistogram === hourHistogram + weekdayHistogram -> ${eq ? "OK" : "MISMATCH"}`,
	);
	if (!eq) process.exitCode = 1;
	time(
		"youtubeTrend",
		() => baseYt.youtubeTrend(records, range, "month"),
		() => curYt.youtubeTrend(records, range, "month"),
	);
	time(
		"buildCalendar (heatmap)",
		// The baseline ignores the range (whole dataset by design); the current
		// build takes it, and VideoView now passes the active window.
		() => baseHeat.buildCalendar(records),
		() => curHeat.buildCalendar(records, range),
	);
};

function report(title: string, names: string[]) {
	console.log(`\n${title}`);
	console.log("-".repeat(72));
	console.log(
		`${"memo".padEnd(32)}${"before".padStart(10)}${"after".padStart(10)}${"delta".padStart(12)}`,
	);
	console.log("-".repeat(72));
	let b = 0;
	let c = 0;
	for (const r of rows) {
		if (!names.includes(r.name)) continue;
		b += r.base;
		c += r.cur;
		const pct = r.base > 0 ? ((1 - r.cur / r.base) * 100).toFixed(0) : "-";
		console.log(
			`${r.name.padEnd(32)}${r.base.toFixed(1).padStart(10)}${r.cur.toFixed(1).padStart(10)}${(pct === "-" ? "-" : `${pct}%`).padStart(12)}`,
		);
	}
	console.log("-".repeat(72));
	console.log(
		`${"TOTAL".padEnd(32)}${b.toFixed(1).padStart(10)}${c.toFixed(1).padStart(10)}${(((1 - c / b) * 100).toFixed(0) + "%").padStart(12)}`,
	);
	return { b, c };
}

console.log(
	`\ndataset: ${N.toLocaleString()} rows (${musicCount.toLocaleString()} music), 14y span`,
);
console.log(
	`distinct tracks: ${cur.topTracks(records, range, {}, { limit: 99_999 }).length.toLocaleString()}`,
);
console.log(`node ${process.version}, best-of-3\n`);

music();
const musicNames = rows.map((r) => r.name);
const m = report("MusicView mount memo set", musicNames);

rows.length = 0;
video();
const v = report(
	"VideoView mount memo set",
	rows.map((r) => r.name),
);

console.log(`\n${"=".repeat(72)}`);
console.log(`MusicView  ${m.b.toFixed(0)}ms -> ${m.c.toFixed(0)}ms`);
console.log(`VideoView  ${v.b.toFixed(0)}ms -> ${v.c.toFixed(0)}ms`);
const tb = m.b + v.b;
const tc = m.c + v.c;
console.log(
	`Combined   ${tb.toFixed(0)}ms -> ${tc.toFixed(0)}ms   (-${((1 - tc / tb) * 100).toFixed(0)}%)`,
);
