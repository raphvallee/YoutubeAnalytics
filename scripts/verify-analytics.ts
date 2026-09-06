/**
 * Analytics oracle — blueprint Phase 2 checkpoint.
 * Run: bun scripts/verify-analytics.ts [path/to/watch-history.json]
 *
 * Computes the "last 30 days of data" top artists and top tracks twice:
 *  1. via the app's normalize + queries pipeline
 *  2. via an independent naive implementation straight over the raw JSON
 *     (re-implements the documented grouping rules — case/diacritic fold,
 *     decoration strip — but with its own code, no shared imports)
 * Both must agree, otherwise the aggregation layer is wrong.
 */

import { topArtists, topTracks } from "../src/analytics/queries";
import {
	normalizeBatch,
	type RawTakeoutEntry,
} from "../src/ingestion/normalize";

const path = process.argv[2] ?? "watch-history.json";
const entries = JSON.parse(await Bun.file(path).text()) as RawTakeoutEntry[];

// Independent normalization (mirrors BLUEPRINT §2.4 rules, own code)
const NOISE =
	/[([]\s*(official\s+(music\s+)?(video|audio)|lyric[s]?\s+video|lyrics?|audio|video\s+oficial|video|hd|hq|4k|explicit|remaster(ed)?(\s+\d{4})?|visualizer)\s*[)\]]/gi;
const FEAT = /[([]?\s*(?:feat|ft|featuring)\.?\s+[^)\]]*[)\]]?/gi;
const fold = (s: string) =>
	s
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/\s+/g, " ")
		.toLowerCase()
		.trim();
const trackFold = (s: string) =>
	fold(
		s
			.replace(NOISE, "")
			.replace(FEAT, "")
			.replace(/\s{2,}/g, " ")
			.trim(),
	);

// --- 1. app pipeline -------------------------------------------------------
const stats = {
	prefixesSeen: [],
	droppedCount: 0,
	droppedSearch: 0,
	droppedBadTime: 0,
};
const records = await normalizeBatch(entries, new Set(), stats);
const maxTs = records.reduce((m, r) => Math.max(m, r.ts), 0);
const minTs = records.reduce(
	(m, r) => Math.min(m, r.ts),
	Number.POSITIVE_INFINITY,
);
const range = { from: maxTs - 30 * 86_400_000, to: maxTs };

const pipelineArtists = topArtists(records, range, {}, 5);
const pipelineTracks = topTracks(records, range, {}, { limit: 1_000_000 });

// --- 2. independent naive implementation -----------------------------------
const normHeader = (h: string) => h.replace(/\s+/g, " ");
const naiveArtists = new Map<string, { plays: number; display: string }>();
const naiveTracks = new Map<
	string,
	{ plays: number; display: string; artist: string | null }
>();

for (const e of entries) {
	const time = Date.parse(e.time ?? "");
	if (!Number.isFinite(time) || time < range.from || time > range.to) continue;
	if (e.details?.some((d) => d.name === "From Google Ads")) continue;
	const isMusic =
		normHeader(e.header) === "YouTube Music" ||
		/music\.youtube\.com/.test(e.titleUrl ?? "");
	if (!isMusic) continue;

	const title = e.title.replace(/^Vous avez regardé /, "");
	const channel = e.subtitles?.[0]?.name ?? "";
	let artist: string | null = null;
	if (channel.endsWith(" - Topic")) {
		const stripped = channel.slice(0, -" - Topic".length).trim();
		if (stripped && stripped.toLowerCase() !== "release") artist = stripped;
	}
	if (!artist) {
		const m = /^(.{1,80}?)\s+[-–—]\s+(.{1,80})$/.exec(title);
		artist = m?.[1]?.trim() ?? null;
	}

	if (artist) {
		const key = fold(artist);
		const cur = naiveArtists.get(key) ?? { plays: 0, display: artist };
		cur.plays += 1;
		naiveArtists.set(key, cur);
	}

	const key = `${artist ? fold(artist) : ""}|${trackFold(title)}`;
	const t = naiveTracks.get(key) ?? { plays: 0, display: title, artist };
	t.plays += 1;
	naiveTracks.set(key, t);
}

const naiveArtistTop = [...naiveArtists.entries()]
	.sort((a, b) => b[1].plays - a[1].plays)
	.slice(0, 5);
const naiveTrackTop = [...naiveTracks.values()].sort(
	(a, b) => b.plays - a.plays,
);
const naiveTrackTop5 = naiveTrackTop.slice(0, 5);

// Ties break differently between implementations (localeCompare vs insertion);
// compare the top sets as (key, plays) multisets, not by position.
const pipelineTrackMap = new Map(
	pipelineTracks.map((t) => [`${t.artistKey}|${t.trackKey}`, t.plays]),
);
const naiveTrackMap = new Map(
	[...naiveTracks.entries()].map(([k, v]) => [k, v.plays]),
);
const trackSetOk =
	pipelineTrackMap.size === naiveTrackMap.size &&
	[...pipelineTrackMap].every(([k, v]) => naiveTrackMap.get(k) === v);

// --- 3. compare -------------------------------------------------------------
console.log(
	`window: ${new Date(range.from).toISOString()} .. ${new Date(maxTs).toISOString()}`,
);
console.log(
	`data span: ${new Date(minTs).toISOString()} .. ${new Date(maxTs).toISOString()}`,
);

let failed = false;
console.log("\nTop artists (pipeline | naive):");
for (
	let i = 0;
	i < Math.max(pipelineArtists.length, naiveArtistTop.length);
	i++
) {
	const p = pipelineArtists[i];
	const n = naiveArtistTop[i];
	const ok = p && n && fold(p.artist) === n[0] && p.plays === n[1].plays;
	if (!ok) failed = true;
	console.log(
		`  ${i + 1}. ${p ? `${p.artist}=${p.plays}` : "—"} | ${n ? `${n[1].display}=${n[1].plays}` : "—"} ${ok ? "" : "  <-- MISMATCH"}`,
	);
}

console.log("\nTop tracks (pipeline | naive):");
for (
	let i = 0;
	i < Math.max(pipelineTracks.length, naiveTrackTop5.length);
	i++
) {
	const p = pipelineTracks[i];
	const n = naiveTrackTop5[i];
	console.log(
		`  ${i + 1}. ${p ? `${p.title} (${p.plays})` : "—"} | ${n ? `${n.display} (${n.plays})` : "—"}`,
	);
}
if (!trackSetOk) failed = true;
console.log(
	trackSetOk
		? `  (full track maps identical: ${pipelineTrackMap.size} tracks)`
		: `  <-- TRACK MAPS DIFFER (${pipelineTrackMap.size} vs ${naiveTrackMap.size})`,
);

console.log(failed ? "\nFAIL" : "\nOK: pipeline agrees with independent count");
process.exitCode = failed ? 1 : 0;
