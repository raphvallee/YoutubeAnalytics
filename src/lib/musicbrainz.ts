/**
 * MusicBrainz release lookup - Phase 6 opt-in enrichment (BLUEPRINT §2.5).
 *
 * NOTE: this is the single, user-toggled exception to locked decision #0
 * ("no external API calls, ever"): approved by the user for Phase 6, off by
 * default, opt-in in the UI, and every response is cached locally so each
 * channelId is queried at most once. All other app surfaces stay offline.
 *
 * MusicBrainz etiquette: ≤ 1 request/second, so lookups go through the
 * pacing loop in `src/state/enrichment.ts`, never fired in a burst.
 */

export const MB_ENDPOINT = "https://musicbrainz.org/ws/2/release";

/** Search text for a release: the track title quoted for an exact-ish match. */
export function buildReleaseQuery(title: string): string {
	return `release:"${title.trim()}"`;
}

export interface MbLookup {
	releaseName: string | null;
	artistName: string | null;
	date: string | null;
}

interface RawRelease {
	title?: string;
	date?: string;
	"artist-credit"?: Array<{ name?: string; artist?: { name?: string } }>;
}

/** Extract the best release from a MusicBrainz search response (pure). */
export function parseReleaseResponse(json: unknown): MbLookup | null {
	const releases = (json as { releases?: RawRelease[] })?.releases;
	const first = releases?.[0];
	if (!first || typeof first.title !== "string" || first.title.length === 0) {
		return null;
	}
	const credit = first["artist-credit"]?.[0];
	return {
		releaseName: first.title,
		artistName: credit?.artist?.name ?? credit?.name ?? null,
		date: typeof first.date === "string" ? first.date : null,
	};
}

/** Fetch one release lookup. `signal` supports cancellation. */
export async function fetchMbRelease(
	query: string,
	signal?: AbortSignal,
): Promise<MbLookup | null> {
	const url = `${MB_ENDPOINT}?query=${encodeURIComponent(query)}&fmt=json&limit=1`;
	const res = await fetch(url, {
		signal,
		headers: { Accept: "application/json" },
	});
	if (!res.ok) throw new Error(`MusicBrainz responded ${res.status}`);
	return parseReleaseResponse(await res.json());
}

/** MusicBrainz rate limit: max ~1 request/second. */
export const MB_MIN_INTERVAL_MS = 1000;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}
