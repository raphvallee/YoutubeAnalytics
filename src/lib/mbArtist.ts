/**
 * MusicBrainz artist lookup - Phase 7 artist-origin map (BLUEPRINT §2.7).
 *
 * Second user-approved exception to locked decision #0: requested by the
 * user for the world-map feature, toggleable in the UI (on by default),
 * paced at MusicBrainz's 1 req/s etiquette, and every result is cached in
 * Dexie so each artistKey is queried at most once.
 *
 * Origin semantics: MusicBrainz' `begin_area` is the birth place for
 * People and the foundation place for Groups - the "where they are from"
 * the feature wants. `area` (main area of activity) is deliberately
 * ignored: that is where the artist lives/works, not where they are from.
 */
import { sleep } from "./musicbrainz";

export const MB_ARTIST_ENDPOINT = "https://musicbrainz.org/ws/2/artist";

/** Search text for an artist: the name quoted for an exact-ish match. */
export function buildArtistQuery(name: string): string {
	return `artist:"${name.trim()}"`;
}

export interface MbArtistHit {
	mbid: string;
	name: string;
	/** "Person" | "Group" | ... as MusicBrainz emitted it. */
	type: string | null;
	/** ISO 3166-1 alpha-2, null when unset (common for groups). */
	country: string | null;
	/** Birth (Person) / foundation (Group) place name, null when unset. */
	beginAreaName: string | null;
}

interface RawArtist {
	id?: unknown;
	name?: unknown;
	type?: unknown;
	country?: unknown;
	"begin-area"?: { name?: unknown };
}

/** Extract the best artist hit from a MusicBrainz search response (pure). */
export function parseArtistResponse(json: unknown): MbArtistHit | null {
	const artists = (json as { artists?: RawArtist[] })?.artists;
	const first = artists?.[0];
	if (!first || typeof first.id !== "string" || first.id.length === 0) {
		return null;
	}
	if (typeof first.name !== "string" || first.name.length === 0) return null;
	const country =
		typeof first.country === "string" && /^[A-Z]{2}$/.test(first.country)
			? first.country
			: null;
	const beginArea = first["begin-area"];
	return {
		mbid: first.id,
		name: first.name,
		type: typeof first.type === "string" ? first.type : null,
		country,
		beginAreaName:
			typeof beginArea?.name === "string" && beginArea.name.length > 0
				? beginArea.name
				: null,
	};
}

async function requestOnce(
	query: string,
	signal?: AbortSignal,
): Promise<MbArtistHit | null> {
	const url = `${MB_ARTIST_ENDPOINT}?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
	const res = await fetch(url, {
		signal,
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`MusicBrainz responded ${res.status}`);
	return parseArtistResponse(await res.json());
}

const RETRY_STATUS = new Set([429, 502, 503]);

/**
 * Fetch one artist lookup. `signal` supports cancellation. Backoff retries
 * on transient statuses (MusicBrainz throws 503s in bursts; a full run is
 * long, so weather them) - permanent misses are clean empty responses,
 * never errors.
 */
export async function fetchMbArtist(
	query: string,
	signal?: AbortSignal,
): Promise<MbArtistHit | null> {
	const backoffs = [5000, 10000, 15000];
	for (;;) {
		try {
			return await requestOnce(query, signal);
		} catch (err) {
			const status =
				err instanceof Error ? err.message.match(/\d{3}$/)?.[0] : undefined;
			const retryable =
				err instanceof Error &&
				status !== undefined &&
				RETRY_STATUS.has(Number(status));
			const delay = backoffs.shift();
			if (signal?.aborted || !retryable || delay === undefined) throw err;
			await sleep(delay, signal);
		}
	}
}
