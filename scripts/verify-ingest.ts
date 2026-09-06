/**
 * Real-data verification — blueprint Phase 1 checkpoint.
 * Run: bun scripts/verify-ingest.ts [path/to/watch-history.json]
 *
 * Asserts the normalized music/youtube split matches the raw `header` split
 * (NBSP-normalized: real Takeout writes "YouTube\xa0Music"), reports
 * dedupe/drop stats and pipeline timing.
 */
import {
	normalizeBatch,
	type RawTakeoutEntry,
} from "../src/ingestion/normalize";

const path = process.argv[2] ?? "watch-history.json";
const file = Bun.file(path);
const text = await file.text();
const entries = JSON.parse(text) as RawTakeoutEntry[];
if (!Array.isArray(entries)) throw new Error(`${path}: expected a JSON array`);

const normHeader = (h: string) => h.replace(/\s+/g, " ");
const headerMusic = entries.filter(
	(e) => normHeader(e.header) === "YouTube Music",
).length;
const headerYouTube = entries.filter(
	(e) => normHeader(e.header) === "YouTube",
).length;

const stats = {
	prefixesSeen: [],
	droppedCount: 0,
	droppedSearch: 0,
	droppedBadTime: 0,
};
const t0 = performance.now();
const records = await normalizeBatch(entries, new Set(), stats);
const elapsedMs = performance.now() - t0;

const kindMusic = records.filter((r) => r.kind === "music").length;
const kindYouTube = records.filter((r) => r.kind === "youtube").length;
const hostOnly = kindMusic - headerMusic;
const duplicates = entries.length - records.length - stats.droppedCount;

console.log(
	`file:            ${path} (${(file.size / 1024 / 1024).toFixed(1)} MB)`,
);
console.log(`entries:         ${entries.length.toLocaleString()}`);
console.log(
	`header split:    music=${headerMusic.toLocaleString()} youtube=${headerYouTube.toLocaleString()}`,
);
console.log(
	`kept:            ${records.length.toLocaleString()} (music=${kindMusic.toLocaleString()} youtube=${kindYouTube.toLocaleString()})`,
);
console.log(
	`host-only music: ${hostOnly.toLocaleString()} (header YouTube + music.youtube.com host)`,
);
console.log(
	`dropped:         ${stats.droppedCount.toLocaleString()}  duplicates: ${duplicates.toLocaleString()}`,
);
console.log(`prefixes seen:   ${JSON.stringify(stats.prefixesSeen)}`);
console.log(
	`unattributed:    ${records.filter((r) => r.kind === "music" && !r.artist).length.toLocaleString()} music rows without artist`,
);
console.log(
	`pipeline:        ${elapsedMs.toFixed(0)} ms (normalize+dedupe, excludes persist)`,
);

let failed = false;
if (headerMusic + headerYouTube !== entries.length) {
	console.log(
		`FAIL: header split ${headerMusic + headerYouTube} != entries ${entries.length}`,
	);
	failed = true;
}
if (hostOnly !== 0) {
	console.log(
		`FAIL: ${hostOnly} rows classified music by host only — header rule missed them`,
	);
	failed = true;
}
if (elapsedMs > 5000) {
	console.log(
		`FAIL: normalize took ${elapsedMs.toFixed(0)} ms > 5000 ms checkpoint budget`,
	);
	failed = true;
}
if (!failed) console.log("OK");
process.exitCode = failed ? 1 : 0;
