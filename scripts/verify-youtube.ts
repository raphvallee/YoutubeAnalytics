/**
 * YouTube analytics oracle — blueprint Phase 4 checkpoint.
 * Run: bun scripts/verify-youtube.ts [path/to/watch-history.json]
 *
 * Computes all-time top channels and the hour histogram twice:
 *  1. via the app pipeline (normalizeBatch + youtube.ts)
 *  2. via an independent naive counter straight over the raw JSON
 * Compares full maps (channels) and full vectors (hours), not just top-5.
 */

import {
	hourHistogram,
	topChannels,
	youtubeTrend,
} from "../src/analytics/youtube";
import {
	normalizeBatch,
	type RawTakeoutEntry,
} from "../src/ingestion/normalize";

const path = process.argv[2] ?? "watch-history.json";
const entries = JSON.parse(await Bun.file(path).text()) as RawTakeoutEntry[];

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
const range = { from: minTs, to: maxTs };

const pipelineChannels = topChannels(records, range, {}, 1_000_000);
const pipelineHours = hourHistogram(records, range);
const pipelineTrend = youtubeTrend(records, range, "month");

// --- 2. independent naive implementation -----------------------------------
const normHeader = (h: string) => h.replace(/\s+/g, " ");
const naiveChannels = new Map<string, number>();
const naiveHours = new Array<number>(24).fill(0);
const naiveTrend = new Map<string, number>();

for (const e of entries) {
	const time = Date.parse(e.time ?? "");
	if (!Number.isFinite(time)) continue;
	if (e.details?.some((d) => d.name === "From Google Ads")) continue;
	if (normHeader(e.header) === "YouTube Music") continue;
	if (/music\.youtube\.com/.test(e.titleUrl ?? "")) continue;

	const channel = e.subtitles?.[0]?.name ?? "(unknown channel)";
	naiveChannels.set(channel, (naiveChannels.get(channel) ?? 0) + 1);
	naiveHours[new Date(time).getHours()] += 1;

	const d = new Date(time);
	const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
	naiveTrend.set(key, (naiveTrend.get(key) ?? 0) + 1);
}

// --- 3. compare -------------------------------------------------------------
// Channel keying differs by design (pipeline prefers channelId), so compare
// the multiset of (display name, plays) pairs.
const pipelineChannelPairs = new Map<string, number>();
for (const c of pipelineChannels)
	pipelineChannelPairs.set(
		c.channel,
		(pipelineChannelPairs.get(c.channel) ?? 0) + c.plays,
	);
const channelOk =
	pipelineChannelPairs.size === naiveChannels.size &&
	[...pipelineChannelPairs].every(([k, v]) => naiveChannels.get(k) === v);

const hoursOk = pipelineHours.every((v, i) => v === naiveHours[i]);

const pipelineTrendNonZero = pipelineTrend.filter((p) => p.plays > 0);
const trendOk =
	pipelineTrendNonZero.length === naiveTrend.size &&
	pipelineTrendNonZero.every((p) => naiveTrend.get(p.key) === p.plays);

console.log(
	`span: ${new Date(minTs).toISOString()} .. ${new Date(maxTs).toISOString()}`,
);
console.log(
	`channels: pipeline=${pipelineChannelPairs.size} naive=${naiveChannels.size} ${channelOk ? "MATCH" : "MISMATCH"}`,
);
console.log(`hours: pipeline=[${pipelineHours.join(",")}]`);
console.log(
	`       naive=  [${naiveHours.join(",")}] ${hoursOk ? "MATCH" : "MISMATCH"}`,
);
console.log(
	`trend months: pipeline=${pipelineTrendNonZero.length} naive=${naiveTrend.size} ${trendOk ? "MATCH" : "MISMATCH"}`,
);

console.log("\nTop 5 channels:");
for (let i = 0; i < 5; i++) {
	const p = pipelineChannels[i];
	console.log(`  ${i + 1}. ${p ? `${p.channel} (${p.plays})` : "—"}`);
}

if (!channelOk) console.log("FAIL: channel maps differ");
if (!hoursOk) console.log("FAIL: hour histograms differ");
if (!trendOk) console.log("FAIL: trend differs");
console.log(
	channelOk && hoursOk && trendOk
		? "\nOK: pipeline agrees with independent count"
		: "\nFAIL",
);
process.exitCode = channelOk && hoursOk && trendOk ? 0 : 1;
