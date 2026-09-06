/** Normalized data model — see docs/BLUEPRINT.md §2.2. */

export type StreamKind = "music" | "youtube";

/**
 * How the artist name was derived:
 * - `topic`: from an "Artist - Topic" auto-generated channel (most reliable)
 * - `parsed`: recovered from the video title ("Artist - Track" shape)
 * - `unknown`: no artist available ("Release - Topic" channels, missing subtitles)
 */
export type ArtistConfidence = "topic" | "parsed" | "unknown";

export interface StreamRecord {
	/** sha1(`${time}::${videoId ?? titleUrl ?? title}`) hex — also the dedupe key. */
	id: string;
	/** Epoch ms from the Takeout `time` field. */
	ts: number;
	kind: StreamKind;
	/** From titleUrl `?v=` param; null when the video was deleted or the URL is unparseable. */
	videoId: string | null;
	/** Cleaned title: locale prefix stripped, decorations removed. */
	title: string;
	/** Untouched Takeout title, for audit/debug. */
	rawTitle: string;
	/** Canonical artist display name, null when unavailable. */
	artist: string | null;
	/** Lowercased trimmed grouping key ('' when no artist). */
	artistKey: string;
	artistConfidence: ArtistConfidence;
	/** Raw subtitle[0].name from Takeout ("Future - Topic", "Release - Topic", plain channel names). */
	channel: string | null;
	channelId: string | null;
	/** `details` contained "From Google Ads" — excluded from organic analytics filters. */
	adDriven: boolean;
}

export const DATASET_SCHEMA_VERSION = 1;

export interface DatasetMeta {
	key: "dataset";
	schemaVersion: number;
	importedAt: number;
	fileCount: number;
	rowCount: number;
	musicCount: number;
	youtubeCount: number;
	/** Rows dropped entirely: missing/invalid time, search ("recherché"/"Searched") rows. */
	droppedCount: number;
	/** Rows skipped because another row had the same id (Takeout duplicate parts). */
	duplicateCount: number;
	/** Music rows with no artist at all (unattributed, e.g. "Release - Topic"). */
	unattributedMusic: number;
	minTs: number;
	maxTs: number;
	/** Distinct Takeout title prefixes seen before stripping (locale diagnostics). */
	prefixesSeen: string[];
}
