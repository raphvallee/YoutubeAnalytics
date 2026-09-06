/** Normalized data model - see docs/BLUEPRINT.md §2.2. */

export type StreamKind = "music" | "youtube";

/**
 * How the artist name was derived:
 * - `topic`: from an "Artist - Topic" auto-generated channel (most reliable)
 * - `parsed`: recovered from the video title ("Artist - Track" shape)
 * - `unknown`: no artist available ("Release - Topic" channels, missing subtitles)
 */
export type ArtistConfidence = "topic" | "parsed" | "unknown";

export interface StreamRecord {
	/** sha1(`${time}::${videoId ?? titleUrl ?? title}`) hex - also the dedupe key. */
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
	/** `details` contained "From Google Ads" - excluded from organic analytics filters. */
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

/**
 * One row of an uploaded "Liked music"/"Liked videos" playlist export
 * (BLUEPRINT §2.6). Takeout playlist CSVs vary; we keep whatever identity
 * fields the file offered and match against streams afterwards.
 */
export interface LikedTrack {
	/** Stable id: videoId when present, else sha1(artist|title). */
	id: string;
	videoId: string | null;
	title: string;
	/** Channel name from the export (not yet normalized to an artist). */
	channel: string | null;
	/** ISO date the video was added to the playlist, when the export has it. */
	addedAt: string | null;
	/** Source playlist file name, for diagnostics. */
	sourceFile: string;
}

/** Snapshot metadata (records live in the parallel `snapshotData` table). */
export interface DatasetSnapshot {
	id: string;
	name: string;
	createdAt: number;
	rowCount: number;
}

/** Blob half of a snapshot: the full in-memory record array, keyed by snapshot id. */
export interface SnapshotData {
	id: string;
	records: StreamRecord[];
}

/**
 * One resolved MusicBrainz lookup (Phase 6, opt-in enrichment - BLUEPRINT
 * §2.5): a "Release - Topic" channelId joined to a release + artist name.
 * Cached so enrichment runs once per channelId.
 */
export interface MbRelease {
	/** YouTube channelId of the "Release - Topic" channel. */
	channelId: string;
	releaseName: string | null;
	artistName: string | null;
	/** Release date string as MusicBrainz emitted it, when present. */
	date: string | null;
	/** Search text that produced this result (audit/debug). */
	query: string;
	resolvedAt: number;
}

/**
 * How precisely an artist's origin was located (Phase 7):
 * - `city`: birth/foundation place geocoded to a populated place
 * - `subdivision`: the begin area itself is a state/province/region
 * - `country`: no begin area (or unresolvable) - country centroid, or a
 *   geocoded MusicBrainz `area` (main activity area, coarser approximation)
 * - `miss`: MusicBrainz had no origin data at all
 */
export type OriginPrecision = "city" | "subdivision" | "country" | "miss";

/**
 * One artist's resolved place of origin (Phase 7 - BLUEPRINT §2.7).
 * Keyed by artistKey and cached forever: survives "Clear data" like the
 * other enrichment caches, so a re-import never re-queries MusicBrainz.
 */
export interface ArtistOrigin {
	/** Lowercased trimmed artist grouping key (StreamRecord.artistKey). */
	artistKey: string;
	/** Display name the lookup was based on. */
	artistName: string;
	/** MusicBrainz artist MBID, null on miss. */
	mbid: string | null;
	/** MusicBrainz-resolved artist name, null on miss (audit for mismatches). */
	resolvedName: string | null;
	precision: OriginPrecision;
	/** Geocoded place (city or subdivision name), null for country/miss. */
	placeName: string | null;
	/** First-level admin division when known (state/province/region). */
	subdivisionName: string | null;
	countryName: string | null;
	/** ISO 3166-1 alpha-2, from MusicBrainz or the geocoder. */
	countryCode: string | null;
	/** Point coordinates; null for "miss". */
	lat: number | null;
	lng: number | null;
	resolvedAt: number;
}
