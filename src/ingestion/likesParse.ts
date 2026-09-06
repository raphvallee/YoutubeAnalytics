/**
 * Tolerant parser for Takeout playlist exports ("Liked music", "Liked
 * videos") — BLUEPRINT §2.6. Takeout emits one CSV per playlist with
 * header names that vary over time; we detect columns by fuzzy header
 * matching instead of hardcoding one format. Plain JSON arrays are also
 * accepted.
 */

import type { LikedTrack } from "@/db/types";

/** Minimal CSV row splitter: double-quote escaping, commas in titles. */
function parseCsvLine(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			out.push(cur);
			cur = "";
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out;
}

/** Header cell -> normalized token for fuzzy matching. */
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z]/g, "");

function findColumn(headers: string[], candidates: string[]): number {
	for (const c of candidates) {
		const idx = headers.findIndex((h) => normHeader(h) === normHeader(c));
		if (idx !== -1) return idx;
	}
	for (const c of candidates) {
		const idx = headers.findIndex((h) => normHeader(h).includes(normHeader(c)));
		if (idx !== -1) return idx;
	}
	return -1;
}

const VIDEO_ID = ["Video Id", "Video ID", "VideoId", "Video id"];
const TITLE = ["Video Title", "Song Title", "Title", "Track"];
const CHANNEL = ["Channel Name", "Artist Name", "Channel", "Artist"];
const DATE = ["Date Created", "Date Added", "creation_timestamp", "Added At"];

/** Parse a playlist export (CSV or JSON array) into LikedTrack rows. */
export function parseLikesFile(text: string, sourceFile: string): LikedTrack[] {
	const trimmed = text.trim();
	if (trimmed.startsWith("[")) {
		const arr = JSON.parse(trimmed) as Array<Record<string, unknown>>;
		return arr.map((row) =>
			likesFromFields({
				videoId: str(row.videoId ?? row.video_id ?? row["Video Id"]),
				title:
					str(
						row.title ?? row.videoTitle ?? row["Video Title"] ?? row.songTitle,
					) ?? "",
				channel: str(
					row.channel ??
						row.artist ??
						row["Channel Name"] ??
						row["Artist Name"],
				),
				addedAt: str(row.addedAt ?? row.dateAdded),
				sourceFile,
			}),
		);
	}

	const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
	if (lines.length < 2) return [];
	const headers = parseCsvLine(lines[0] ?? "");
	const idCol = findColumn(headers, VIDEO_ID);
	const titleCol = findColumn(headers, TITLE);
	const channelCol = findColumn(headers, CHANNEL);
	const dateCol = findColumn(headers, DATE);
	if (titleCol === -1 && idCol === -1) return [];

	const out: LikedTrack[] = [];
	for (const line of lines.slice(1)) {
		const cells = parseCsvLine(line);
		const at = (i: number) =>
			i >= 0 && i < cells.length ? (cells[i]?.trim() ?? "") : "";
		out.push(
			likesFromFields({
				videoId: at(idCol) || null,
				title: at(titleCol),
				channel: at(channelCol) || null,
				addedAt: at(dateCol) || null,
				sourceFile,
			}),
		);
	}
	return out;
}

function str(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

function likesFromFields(f: {
	videoId: string | null;
	title: string;
	channel: string | null;
	addedAt: string | null;
	sourceFile: string;
}): LikedTrack {
	const title = f.title || f.videoId || "(unknown track)";
	return {
		id: f.videoId ?? `h:${fnv1aHex(`${f.channel ?? ""}|${title}`)}`,
		videoId: f.videoId,
		title,
		channel: f.channel,
		addedAt: f.addedAt,
		sourceFile: f.sourceFile,
	};
}

// FNV-1a: id only needs stability, not cryptographic strength.
function fnv1aHex(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}
