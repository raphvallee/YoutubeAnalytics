/**
 * Synthetic 100MB perf pass - blueprint Phase 5 checkpoint.
 * Run: bun scripts/perf-100mb.ts [targetMB]
 *
 * Generates a synthetic Takeout-shaped JSON of ~targetMB, then times the
 * real normalizeBatch pipeline (parse excluded, as in verify-ingest) and
 * reports throughput + RSS delta. Asserts < 30s for 100MB.
 */
import {
	normalizeBatch,
	type RawTakeoutEntry,
} from "../src/ingestion/normalize";

const targetMB = Number(process.argv[2] ?? 100);
const approxRowBytes = 257; // measured: synthetic rows average ~257 B (real Takeout rows are heavier)
const rowCount = Math.round((targetMB * 1024 * 1024) / approxRowBytes);

const ARTISTS = [
	"Future",
	"Rich Amiri",
	"Don Toliver",
	"Release",
	"EsDeeKid",
	"Lil Baby",
	"Ken Carson",
];
const TRACKS = [
	"Mask Off",
	"true colors",
	"LEGACY",
	"Neva Missa Lost",
	"Century",
	"Paranoid",
	"Never Stop",
];
const VIDEOS = ["Min", "General Jimbob", "Vivilly", "Pixel GTA", "Matan Even"];

function makeEntries(n: number): RawTakeoutEntry[] {
	const entries: RawTakeoutEntry[] = new Array(n);
	const start = Date.UTC(2020, 0, 1);
	for (let i = 0; i < n; i++) {
		const music = i % 3 !== 0; // ~2/3 music like the real file
		const artist = ARTISTS[i % ARTISTS.length] ?? "Unknown";
		const track = TRACKS[i % TRACKS.length] ?? "Track";
		const video = VIDEOS[i % VIDEOS.length] ?? "Channel";
		entries[i] = music
			? {
					header: "YouTube Music",
					title: `Vous avez regardé ${track}`,
					titleUrl: `https://music.youtube.com/watch?v=vid${String(i % 100_000).padStart(6, "0")}`,
					subtitles: [
						{
							name: `${artist} - Topic`,
							url: `https://www.youtube.com/channel/UC${artist.replace(/\s/g, "")}`,
						},
					],
					time: new Date(start + (i % 2400) * 3_600_000 * 24).toISOString(),
					products: ["YouTube"],
				}
			: {
					header: "YouTube",
					title: `Vous avez regardé Some Video ${i % 10_000}`,
					titleUrl: `https://www.youtube.com/watch?v=ytv${String(i % 100_000).padStart(6, "0")}`,
					subtitles: [
						{
							name: video,
							url: `https://www.youtube.com/channel/UC${video.replace(/\s/g, "")}`,
						},
					],
					time: new Date(start + (i % 2400) * 3_600_000 * 24).toISOString(),
					products: ["YouTube"],
				};
	}
	return entries;
}

console.log(
	`generating ~${targetMB}MB synthetic dataset (${rowCount.toLocaleString()} rows)…`,
);
const tGen = performance.now();
const entries = makeEntries(rowCount);
const json = JSON.stringify(entries);
console.log(
	`generated: ${(json.length / 1024 / 1024).toFixed(1)} MB in ${(performance.now() - tGen).toFixed(0)} ms`,
);

const mem0 = process.memoryUsage().rss ?? 0;
const t0 = performance.now();
const stats = {
	prefixesSeen: [],
	droppedCount: 0,
	droppedSearch: 0,
	droppedBadTime: 0,
};
const records = await normalizeBatch(entries, new Set(), stats);
const elapsed = performance.now() - t0;
const rssDelta = ((process.memoryUsage().rss ?? 0) - mem0) / 1024 / 1024;

console.log(
	`normalize+dedupe: ${elapsed.toFixed(0)} ms for ${records.length.toLocaleString()} kept rows (${(((rowCount / elapsed) * 1000) / 1000).toFixed(1)}k rows/s)`,
);
console.log(`RSS delta: ${rssDelta.toFixed(0)} MB`);

if (elapsed > 30_000) {
	console.log(`FAIL: ${elapsed.toFixed(0)} ms > 30 s budget for ${targetMB}MB`);
	process.exitCode = 1;
} else {
	console.log(`OK (< 30 s budget for ${targetMB}MB)`);
}
