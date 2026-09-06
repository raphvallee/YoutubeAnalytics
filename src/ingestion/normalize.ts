/**
 * Takeout entry normalization - docs/BLUEPRINT.md §2.
 * Pure and testable: no DOM, no Dexie, no worker globals.
 */

import type { ArtistConfidence, StreamKind, StreamRecord } from "@/db/types";
import { stripTitlePrefix } from "./prefixes";
import {
	artistFromTopicChannel,
	artistKeyOf,
	parseArtistFromTitle,
	stripDecorations,
} from "./titleParse";

/** Exactly what Google emits (fields we ignore are omitted) - BLUEPRINT §2.1. */
export interface RawTakeoutEntry {
	header: string;
	title: string;
	titleUrl?: string;
	subtitles?: Array<{ name?: string; url?: string }>;
	time: string;
	products?: string[];
	activityControls?: string[];
	details?: Array<{ name: string }>;
}

export type NormalizeResult =
	| { drop: "search" | "badTime"; rawTitle: string }
	| { record: Omit<StreamRecord, "id">; prefixSeen: string };

export function classifyKind(header: string, titleUrl?: string): StreamKind {
	// Real Takeout exports use a non-breaking space (U+00A0) inside
	// "YouTube Music" - JS \s matches it, so collapse whitespace first.
	if (header.replace(/\s+/g, " ") === "YouTube Music") return "music";
	if (titleUrl) {
		try {
			if (new URL(titleUrl).hostname === "music.youtube.com") return "music";
		} catch {
			// unparseable URL - fall through
		}
	}
	return "youtube";
}

export function extractVideoId(titleUrl?: string): string | null {
	if (!titleUrl) return null;
	try {
		return new URL(titleUrl).searchParams.get("v");
	} catch {
		return null;
	}
}

export function extractChannelId(
	subtitles?: RawTakeoutEntry["subtitles"],
): string | null {
	const url = subtitles?.[0]?.url;
	if (!url) return null;
	const match = /\/channel\/(UC[\w-]+)/.exec(url);
	return match ? (match[1] ?? null) : null;
}

function firstSubtitleName(
	subtitles?: RawTakeoutEntry["subtitles"],
): string | null {
	return subtitles?.[0]?.name ?? null;
}

function isAdDriven(details?: RawTakeoutEntry["details"]): boolean {
	return details?.some((d) => d.name === "From Google Ads") ?? false;
}

/**
 * Artist resolution, in precedence order (BLUEPRINT §2.4 step 3):
 * a. Topic channel (poison guard: "Release" -> null)
 * b. Title "A - B" parse
 * c. null / unknown
 */
export function resolveArtist(
	channel: string | null,
	cleanedTitle: string,
): {
	artist: string | null;
	confidence: ArtistConfidence;
	topicHint: string | null;
} {
	const topicArtist = channel ? artistFromTopicChannel(channel) : null;
	if (topicArtist) {
		return { artist: topicArtist, confidence: "topic", topicHint: topicArtist };
	}
	const parsed = parseArtistFromTitle(cleanedTitle, null);
	if (parsed) {
		return { artist: parsed.artist, confidence: "parsed", topicHint: null };
	}
	return { artist: null, confidence: "unknown", topicHint: null };
}

export function normalizeEntry(entry: RawTakeoutEntry): NormalizeResult {
	const strip = stripTitlePrefix(entry.title);

	if (strip.type === "search") {
		return { drop: "search", rawTitle: entry.title };
	}
	// Loose search markers embedded mid-string (CJK families).
	if (
		strip.type === "unknown" &&
		/recherch|Searched |gesucht/.test(entry.title) &&
		!entry.titleUrl
	) {
		return { drop: "search", rawTitle: entry.title };
	}

	const timeMs = entry.time ? Date.parse(entry.time) : Number.NaN;
	if (Number.isNaN(timeMs)) {
		return { drop: "badTime", rawTitle: entry.title };
	}

	const prefixSeen = strip.type === "stream" ? strip.prefix : "(none)";
	const cleanedTitle = stripDecorations(strip.title);
	const displayTitle = cleanedTitle || entry.title;

	const kind = classifyKind(entry.header, entry.titleUrl);
	const channel = firstSubtitleName(entry.subtitles);
	const { artist, confidence } =
		kind === "music"
			? resolveArtist(channel, cleanedTitle)
			: { artist: null, confidence: "unknown" as const };

	return {
		prefixSeen,
		record: {
			ts: timeMs,
			kind,
			videoId: extractVideoId(entry.titleUrl),
			title: displayTitle,
			rawTitle: entry.title,
			artist,
			artistKey: artist ? artistKeyOf(artist) : "",
			artistConfidence: confidence,
			channel,
			channelId: extractChannelId(entry.subtitles),
			adDriven: isAdDriven(entry.details),
		},
	};
}

async function sha1Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(input),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export interface NormalizeStats {
	prefixesSeen: string[];
	droppedCount: number;
	droppedSearch: number;
	droppedBadTime: number;
}

/**
 * Normalize a batch, dedupe by id, sort by ts ascending.
 * `existingIds` carries ids across files/batches so re-uploaded Takeout parts
 * (or overlapping exports) merge harmlessly.
 */
export async function normalizeBatch(
	entries: RawTakeoutEntry[],
	existingIds: Set<string>,
	stats: NormalizeStats,
): Promise<StreamRecord[]> {
	const records: StreamRecord[] = [];

	await Promise.all(
		entries.map(async (entry) => {
			const result = normalizeEntry(entry);
			if ("drop" in result) {
				stats.droppedCount += 1;
				return;
			}
			if (!stats.prefixesSeen.includes(result.prefixSeen)) {
				stats.prefixesSeen.push(result.prefixSeen);
			}
			const base = result.record;
			const id = await sha1Hex(
				`${entry.time}::${base.videoId ?? base.rawTitle}`,
			);
			// No await between has() and add(): first writer in the batch wins.
			if (existingIds.has(id)) return;
			existingIds.add(id);
			records.push({ ...base, id });
		}),
	);

	records.sort((a, b) => a.ts - b.ts);
	return records;
}
