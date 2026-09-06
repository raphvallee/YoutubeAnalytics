/**
 * Open-Meteo geocoding - Phase 7 artist-origin map (BLUEPRINT §2.7).
 *
 * Free, keyless geocoder for MusicBrainz begin-area names. Part of the
 * same user-approved network exception as mbArtist.ts. Unlike MusicBrainz
 * there is no 1 req/s etiquette here, so calls are not paced.
 */

export const GEOCODE_ENDPOINT =
	"https://geocoding-api.open-meteo.com/v1/search";

/**
 * Search URL for one place. `countryCode` (ISO 3166-1 alpha-2, usually the
 * MusicBrainz artist country) strongly disambiguates common place names.
 */
export function buildGeocodeUrl(
	name: string,
	countryCode: string | null,
): string {
	let url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(name.trim())}&count=1&language=en&format=json`;
	if (countryCode) url += `&countryCode=${encodeURIComponent(countryCode)}`;
	return url;
}

export interface GeoHit {
	name: string;
	latitude: number;
	longitude: number;
	country: string | null;
	/** ISO 3166-1 alpha-2. */
	countryCode: string | null;
	/** First-level admin division (state/province/region) when known. */
	admin1: string | null;
	/** Open-Meteo feature code: P* = populated place, ADM* = division. */
	featureCode: string | null;
}

interface RawGeo {
	name?: unknown;
	latitude?: unknown;
	longitude?: unknown;
	country?: unknown;
	country_code?: unknown;
	admin1?: unknown;
	feature_code?: unknown;
}

function str(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

/** Extract the first geocoding result (pure). Absent `results` = no match. */
export function parseGeocodeResponse(json: unknown): GeoHit | null {
	const results = (json as { results?: RawGeo[] })?.results;
	const first = results?.[0];
	if (!first) return null;
	if (
		typeof first.name !== "string" ||
		first.name.length === 0 ||
		typeof first.latitude !== "number" ||
		typeof first.longitude !== "number"
	) {
		return null;
	}
	return {
		name: first.name,
		latitude: first.latitude,
		longitude: first.longitude,
		country: str(first.country),
		countryCode: str(first.country_code),
		admin1: str(first.admin1),
		featureCode: str(first.feature_code),
	};
}

/** Fetch one geocoding lookup. `signal` supports cancellation. */
export async function fetchGeocode(
	name: string,
	countryCode: string | null,
	signal?: AbortSignal,
): Promise<GeoHit | null> {
	const res = await fetch(buildGeocodeUrl(name, countryCode), { signal });
	if (!res.ok) throw new Error(`Geocoding responded ${res.status}`);
	return parseGeocodeResponse(await res.json());
}

/**
 * Was the searched name itself an admin division (state/province) rather
 * than a city? ADM* feature codes say so directly. Populated-place codes
 * (P*) win over the admin1-equality heuristic - Stockholm city and
 * Stockholm county share a name, but the birth place is the city.
 */
export function classifyPrecision(
	hit: GeoHit,
	searchedName: string,
): "city" | "subdivision" {
	if (hit.featureCode?.startsWith("ADM")) return "subdivision";
	if (hit.featureCode?.startsWith("P")) return "city";
	if (
		hit.admin1 &&
		hit.admin1.trim().toLowerCase() === searchedName.trim().toLowerCase()
	) {
		return "subdivision";
	}
	return "city";
}
