/**
 * Content-based file classification - no filename heuristics.
 *
 * Filenames are the worst possible signal here: every Takeout part is called
 * `watch-history.json`, exports taken months apart land in separate folders
 * under the same name, and users rename files. Worse, the *siblings* of
 * watch-history.json are also JSON arrays (`search-history.json` is
 * `[{query, time}]`, `subscriptions.json` is channel objects), so "is it a
 * JSON array" is not a gate - it lets a folder-wide drop through and then
 * yields a silent 0-row import.
 *
 * So we decide by shape instead: sample the leading entries of the array and
 * require the Takeout watch-history contract (a 	itle`, a `header` or
 * 	itleUrl`, and a parseable 	ime`). Anything else is reported with the
 * reason it was rejected, and playlist exports are recognized so one drop can
 * feed both datasets.
 *
 * Pure and testable: no DOM, no worker globals. Works on a *prefix* of a file
 * (the classifier only ever needs the first few entries), which is what lets
 * the dropzone sniff a 2 GB file without reading it.
 */

export type FileRole = "watch-history" | "playlist" | "unknown";

export interface FileVerdict {
	name: string;
	size: number;
	role: FileRole;
	/** Human-readable explanation, shown verbatim in the preflight table. */
	reason: string;
	/**
	 * Content fingerprint (see {@link contentSignature}), or null when it was
	 * not computed. Two staged files with the same signature are the same
	 * bytes, which is what lets identically-named exports coexist.
	 */
	signature: string | null;
}

/** Entries sampled from the head of the array. Enough to judge shape, cheap to scan. */
const SAMPLE_ENTRIES = 200;

/**
 * Share of sampled entries that must look like Takeout history for the file to
 * be accepted as one. Deliberately low: sibling Takeout files score 0, so the
 * threshold is not the safety mechanism - the shape contract is. It only
 * guards against files that *mix* shapes, where we would rather reject than
 * quietly import a fraction of the rows.
 */
const HISTORY_ACCEPT_RATE = 0.8;

/** Share of sampled entries that must look like a playlist export. */
const PLAYLIST_ACCEPT_RATE = 0.5;

export interface ArrayPrefix {
	/** Payload starts with `[` (a JSON array). */
	isArray: boolean;
	/** Parsed leading elements, up to `maxEntries`. */
	entries: unknown[];
	/** The closing `]` was seen, so the sample covers the whole file. */
	complete: boolean;
}

function isWs(ch: string | undefined): boolean {
	return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * A UTF-8 BOM decodes to U+FEFF, which is not whitespace to 	rim()` in
 * neither direction we care about. Windows-edited exports carry one, and
 * without this a valid history silently stops looking like an array.
 */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Index of the bracket closing the one at `start`, or -1 if truncated. */
function matchBalanced(text: string, start: number): number {
	let depth = 0;
	let inString = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i] as string;
		if (inString) {
			// Titles contain quotes and backslashes: skip escaped chars so a
			// `\"` never ends the string early.
			if (ch === "\\") i++;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{" || ch === "[") depth++;
		else if (ch === "}" || ch === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** End index (inclusive) of a scalar element starting at `start`, or -1. */
function matchScalar(text: string, start: number): number {
	if (text[start] === '"') {
		for (let i = start + 1; i < text.length; i++) {
			const ch = text[i] as string;
			if (ch === "\\") i++;
			else if (ch === '"') return i;
		}
		return -1;
	}
	for (let i = start; i < text.length; i++) {
		const ch = text[i] as string;
		if (ch === "," || ch === "]" || ch === "\n") return i - 1;
	}
	return -1;
}

/**
 * Extract up to `maxEntries` complete elements from the head of a JSON array.
 * Tolerates truncation mid-element (that is the normal case when classifying a
 * file prefix), so a caller can hand it the first N bytes of a 2 GB file.
 */
export function scanArrayPrefix(text: string, maxEntries: number): ArrayPrefix {
	let i = 0;
	if (text.charCodeAt(0) === 0xfeff) i = 1;
	while (i < text.length && isWs(text[i])) i++;
	if (text[i] !== "[") return { isArray: false, entries: [], complete: false };
	i++;

	const entries: unknown[] = [];
	while (i < text.length && entries.length < maxEntries) {
		while (i < text.length && (isWs(text[i]) || text[i] === ",")) i++;
		if (i >= text.length) break;
		const ch = text[i] as string;
		if (ch === "]") return { isArray: true, entries, complete: true };

		const end =
			ch === "{" || ch === "[" ? matchBalanced(text, i) : matchScalar(text, i);
		// Truncated or malformed element: keep what we have and stop.
		if (end < 0) break;
		try {
			entries.push(JSON.parse(text.slice(i, end + 1)));
		} catch {
			break;
		}
		i = end + 1;
	}
	return { isArray: true, entries, complete: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The Takeout watch-history contract: a title, an origin header/URL, a time. */
export function looksLikeHistoryEntry(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (typeof value.title !== "string") return false;
	if (typeof value.header !== "string" && typeof value.titleUrl !== "string")
		return false;
	return (
		typeof value.time === "string" && !Number.isNaN(Date.parse(value.time))
	);
}

/**
 * A liked-playlist export. Note this deliberately does *not* accept bare title
 * strings: routing those to the likes parser would manufacture rows titled
 * "(unknown track)", which is worse than skipping the file.
 */
export function looksLikePlaylistEntry(value: unknown): boolean {
	if (!isRecord(value)) return false;
	const hasVideo =
		typeof value.videoId === "string" ||
		typeof value.video_id === "string" ||
		typeof value["Video Id"] === "string";
	if (hasVideo) return true;
	// Title plus an added-date, but *no* watch time. Requiring the date is what
	// keeps subscriptions.json (title + channelId, no date) out: routing those
	// to the likes parser would file a whole subscriptions list as liked
	// tracks.
	const hasTitle =
		typeof value.title === "string" ||
		typeof value.videoTitle === "string" ||
		typeof value["Video Title"] === "string";
	const hasAddedAt =
		typeof value.addedAt === "string" ||
		typeof value.dateAdded === "string" ||
		typeof value.date === "string";
	return hasTitle && hasAddedAt && value.time === undefined;
}

/** Best-effort explanation of what a rejected array actually contained. */
function describeMismatch(sampled: unknown[]): string {
	if (sampled.every((e) => typeof e === "string")) {
		return "A list of plain strings, not a watch history.";
	}
	const objects = sampled.filter(isRecord);
	if (objects.length > 0) {
		if (objects.every((o) => typeof o.query === "string")) {
			return "Looks like search-history.json (query rows), not watch history.";
		}
		if (
			objects.every(
				(o) => typeof o.title === "string" && typeof o.time !== "string",
			)
		) {
			return "Looks like subscriptions.json (channel rows), not watch history.";
		}
	}
	return "No recognizable watch-history rows in the sampled entries.";
}

const PLAYLIST_HEADER_HINTS = /video|title|song|track|playlist/i;

function verdict(
	name: string,
	size: number,
	role: FileRole,
	reason: string,
	signature: string | null = null,
): FileVerdict {
	return { name, size, role, reason, signature };
}

/**
 * Classify a Takeout file by content. 	ext` may be a prefix of the file: only
 * the leading entries are needed to judge shape.
 */
export function classifyTakeoutText(
	rawText: string,
	name: string,
	size = rawText.length,
	signature: string | null = null,
): FileVerdict {
	const text = stripBom(rawText);
	const scan = scanArrayPrefix(text, SAMPLE_ENTRIES);

	if (!scan.isArray) {
		if (text.trim().length === 0) {
			return verdict(name, size, "unknown", "Empty file.");
		}
		const head = text.slice(0, 4096);
		const firstChar = head.trimStart()[0];
		if (firstChar === "{" || firstChar === '"') {
			return verdict(name, size, "unknown", "Not a JSON array.");
		}
		const firstLine = head.split(/\r?\n/)[0] ?? "";
		if (firstLine.includes(",") && PLAYLIST_HEADER_HINTS.test(firstLine)) {
			return verdict(name, size, "playlist", "CSV playlist - routed to likes.");
		}
		return verdict(
			name,
			size,
			"unknown",
			"Not a Takeout history or playlist file.",
		);
	}

	const sampled = scan.entries;
	if (sampled.length === 0) {
		return verdict(
			name,
			size,
			"unknown",
			scan.complete
				? "Empty file - the JSON array has no entries."
				: "No readable entries at the start of the file.",
		);
	}

	let history = 0;
	let playlist = 0;
	for (const entry of sampled) {
		if (looksLikeHistoryEntry(entry)) history++;
		else if (looksLikePlaylistEntry(entry)) playlist++;
	}

	if (history / sampled.length >= HISTORY_ACCEPT_RATE) {
		const suffix = scan.complete ? "" : "+";
		return verdict(
			name,
			size,
			"watch-history",
			`Watch history - ${history}${suffix} sampled entries match Takeout history.`,
			signature,
		);
	}
	if (playlist / sampled.length >= PLAYLIST_ACCEPT_RATE) {
		return verdict(
			name,
			size,
			"playlist",
			"Playlist export - routed to likes.",
			signature,
		);
	}
	return verdict(name, size, "unknown", describeMismatch(sampled), signature);
}

/** Bytes hashed from each end of the file. Middle bytes are not read. */
const SIGNATURE_EDGE_BYTES = 64 * 1024;

/**
 * Content fingerprint of a file: sha1 over its size plus its first and last
 * 64 KB. Cheap enough to run on every staged file (a 2 GB export reads 128 KB),
 * and enough to tell two same-named exports apart.
 *
 * This is deliberately not a full-file hash: it identifies *files*, and reading
 * gigabytes per drop to learn that `watch-history.json` is new again would make
 * the drop feel broken. Two different files sharing name, size and both edges
 * would collide, which for Takeout exports is not a realistic case.
 */
export async function contentSignature(
	size: number,
	head: string,
	tail: string,
): Promise<string> {
	const parts = [`size:${size}`, `head:${head.length}`, `tail:${tail.length}`];
	// Length-prefix each slice so a shift across the boundary cannot produce
	// the same concatenation.
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(`${parts.join("|")}\n${head}\n${tail}`),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

/** Read the head and tail of a File and fingerprint it. */
export async function signatureOf(file: File): Promise<string> {
	if (file.size <= SIGNATURE_EDGE_BYTES * 2) {
		const whole = await file.text();
		return contentSignature(file.size, whole, "");
	}
	const [head, tail] = await Promise.all([
		file.slice(0, SIGNATURE_EDGE_BYTES).text(),
		file.slice(file.size - SIGNATURE_EDGE_BYTES).text(),
	]);
	return contentSignature(file.size, head, tail);
}

/**
 * Split "watch-history.json" into stem "watch-history" and extension ".json"
 * so a disambiguating counter can go between them.
 */
function splitExtension(name: string): { stem: string; ext: string } {
	const dot = name.lastIndexOf(".");
	// A leading dot is part of the name (".gitignore"), not an extension.
	if (dot <= 0) return { stem: name, ext: "" };
	return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * Disambiguate display names inside one staging batch.
 *
 * Every Takeout export contains a `watch-history.json`, and a batch routinely
 * holds several of them. Name alone cannot identify a row, so when a name
 * appears more than once the repeats get a counter based on how many files in
 * the batch carry that exact name: `watch-history.json`, `watch-history-2.json`,
 * `watch-history-3.json`. The first occurrence keeps its real name.
 *
 * Callers collapse identical bytes (same {@link contentSignature}) before this
 * runs, so a surviving repeat is genuinely different data and needs its own
 * label.
 */
export function disambiguateNames(files: { name: string }[]): string[] {
	const occurrence = new Map<string, number>();
	return files.map((f) => {
		const nth = (occurrence.get(f.name) ?? 0) + 1;
		occurrence.set(f.name, nth);
		if (nth === 1) return f.name;
		const { stem, ext } = splitExtension(f.name);
		return `${stem}-${nth}${ext}`;
	});
}

/** Count what a set of verdicts will actually import (for the preflight header). */
export function tallyVerdicts(verdicts: FileVerdict[]): {
	histories: number;
	playlists: number;
	skipped: number;
} {
	let histories = 0;
	let playlists = 0;
	let skipped = 0;
	for (const v of verdicts) {
		if (v.role === "watch-history") histories++;
		else if (v.role === "playlist") playlists++;
		else skipped++;
	}
	return { histories, playlists, skipped };
}
