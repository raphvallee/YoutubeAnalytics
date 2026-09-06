import { create } from "zustand";
import {
	allArtistOrigins,
	clearArtistOrigins,
	putArtistOrigins,
} from "@/db/db";
import type { ArtistOrigin, StreamRecord } from "@/db/types";
import { countryCentroid } from "@/lib/geo";
import { classifyPrecision, fetchGeocode, type GeoHit } from "@/lib/geocode";
import { isoCountry } from "@/lib/iso";
import {
	buildArtistQuery,
	fetchMbArtist,
	type MbArtistHit,
} from "@/lib/mbArtist";
import { MB_MIN_INTERVAL_MS, sleep } from "@/lib/musicbrainz";
import { useDatasetStore } from "@/state/dataset";

const OPTIN_KEY = "origin-lookup-optin";

/**
 * User-toggled permission for the Phase 7 network lookups (MusicBrainz
 * artist search + Open-Meteo geocoding). Unlike the Phase 6 opt-in this
 * defaults to ON: absent key means allowed, only an explicit "0" opts out.
 */
export function isOriginLookupOn(): boolean {
	return localStorage.getItem(OPTIN_KEY) !== "0";
}
export function setOriginLookupOn(on: boolean): void {
	if (on) localStorage.removeItem(OPTIN_KEY);
	else localStorage.setItem(OPTIN_KEY, "0");
}

export interface OriginTarget {
	artistKey: string;
	artist: string;
	plays: number;
}

/**
 * Every attributed music artist over ALL records (the map is all-time by
 * definition), ranked by plays desc, minus already-cached artistKeys.
 */
export function originTargets(
	records: StreamRecord[],
	cache: ArtistOrigin[],
): OriginTarget[] {
	const cached = new Set(cache.map((c) => c.artistKey));
	const counts = new Map<string, OriginTarget>();
	for (const r of records) {
		if (r.kind !== "music" || !r.artistKey) continue;
		let t = counts.get(r.artistKey);
		if (!t) {
			t = { artistKey: r.artistKey, artist: r.artist ?? r.artistKey, plays: 0 };
			counts.set(r.artistKey, t);
		}
		t.plays += 1;
	}
	return [...counts.values()]
		.sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist))
		.filter((t) => !cached.has(t.artistKey));
}

/**
 * Pure decision matrix turning lookup results into a cache row (everything
 * but the primary key and timestamp). Priority: birth/foundation place >
 * state/province > country > miss.
 */
export function originFromLookups(
	mb: MbArtistHit | null,
	geo: GeoHit | null,
	centroid: { lat: number; lng: number } | null,
): Omit<ArtistOrigin, "artistKey" | "artistName" | "resolvedAt"> {
	if (!mb) {
		return {
			mbid: null,
			resolvedName: null,
			precision: "miss",
			placeName: null,
			subdivisionName: null,
			countryName: null,
			countryCode: null,
			lat: null,
			lng: null,
		};
	}
	const place = mb.beginAreaName ?? mb.areaName;
	if (place && geo) {
		// The begin area is the real origin; the `area` fallback is the main
		// area of activity - coarser, so it is labelled country-level.
		const fromBeginArea = mb.beginAreaName !== null;
		return {
			mbid: mb.mbid,
			resolvedName: mb.name,
			precision: fromBeginArea ? classifyPrecision(geo, place) : "country",
			placeName: fromBeginArea ? geo.name : null,
			subdivisionName: fromBeginArea ? geo.admin1 : null,
			countryName: geo.country,
			countryCode: geo.countryCode ?? mb.country,
			lat: geo.latitude,
			lng: geo.longitude,
		};
	}
	// No usable begin/area name (or it wouldn't geocode): fall back to the
	// country centroid - MusicBrainz' country is origin-ish for People and
	// an approximation for Groups (their begin area is usually absent).
	if (mb.country) {
		const iso = isoCountry(mb.country);
		if (centroid) {
			return {
				mbid: mb.mbid,
				resolvedName: mb.name,
				precision: "country",
				placeName: null,
				subdivisionName: null,
				countryName: iso?.name ?? null,
				countryCode: mb.country,
				lat: centroid.lat,
				lng: centroid.lng,
			};
		}
		// Unmappable country (e.g. XK Kosovo): still record the country.
		return {
			mbid: mb.mbid,
			resolvedName: mb.name,
			precision: "miss",
			placeName: null,
			subdivisionName: null,
			countryName: iso?.name ?? null,
			countryCode: mb.country,
			lat: null,
			lng: null,
		};
	}
	return {
		mbid: mb.mbid,
		resolvedName: mb.name,
		precision: "miss",
		placeName: null,
		subdivisionName: null,
		countryName: null,
		countryCode: null,
		lat: null,
		lng: null,
	};
}

interface OriginsState {
	cache: ArtistOrigin[];
	running: boolean;
	progress: { done: number; total: number };
	error: string | null;
	reload: () => void;
	/** Start resolving uncached artists (no-op when already running). */
	start: () => void;
	/** Abort the current run; batched progress already persisted survives. */
	cancel: () => void;
}

let activeController: AbortController | null = null;

export const useOriginsStore = create<OriginsState>((set, get) => ({
	cache: [],
	running: false,
	progress: { done: 0, total: 0 },
	error: null,
	reload: () => {
		void allArtistOrigins().then((cache) => set({ cache }));
	},
	start: () => {
		if (get().running) return;
		if (!isOriginLookupOn()) return;
		const records = useDatasetStore.getState().records;
		if (records.length === 0) return;
		// Hydrate the cache from Dexie before computing targets: a
		// just-opened app may start the run before reload() resolves, and
		// stale-empty targets would re-query already-cached artists.
		void (async () => {
			const cache = await allArtistOrigins();
			if (get().running) return;
			set({ cache });
			if (originTargets(records, cache).length === 0) return;
			const controller = new AbortController();
			activeController = controller;
			void runLookups(controller.signal, set, get);
		})();
	},
	cancel: () => {
		activeController?.abort();
	},
}));

async function runLookups(
	signal: AbortSignal,
	set: (partial: Partial<OriginsState>) => void,
	get: () => OriginsState,
): Promise<void> {
	const records = useDatasetStore.getState().records;
	const targets = originTargets(records, get().cache);
	set({
		running: true,
		error: null,
		progress: { done: 0, total: targets.length },
	});
	const pending: ArtistOrigin[] = [];
	try {
		for (let i = 0; i < targets.length; i++) {
			signal.throwIfAborted();
			const target = targets[i];
			if (!target) break;

			let mb: MbArtistHit | null = null;
			try {
				mb = await fetchMbArtist(buildArtistQuery(target.artist), signal);
			} finally {
				// MusicBrainz etiquette: pace every request, hit or miss.
				await sleep(MB_MIN_INTERVAL_MS, signal);
			}

			let geo: GeoHit | null = null;
			const place = mb?.beginAreaName ?? mb?.areaName;
			if (place && mb) {
				geo = await fetchGeocode(place, mb.country, signal);
			}
			const centroid = geo ? null : countryCentroid(mb?.country);

			pending.push({
				artistKey: target.artistKey,
				artistName: target.artist,
				resolvedAt: Date.now(),
				...originFromLookups(mb, geo, centroid),
			});
			set({ progress: { done: i + 1, total: targets.length } });
			// Persist in small batches and grow the cache live so the map
			// fills in while a long run is still going.
			if (pending.length >= 5) {
				const batch = pending.splice(0, pending.length);
				await putArtistOrigins(batch);
				set({ cache: [...get().cache, ...batch] });
			}
		}
	} catch (err) {
		// HTTP/network errors write no row: only clean empty responses are
		// permanent misses, so a transient blip never poisons the cache.
		if (!(err instanceof DOMException && err.name === "AbortError")) {
			set({
				error:
					err instanceof Error ? err.message : "Artist-origin lookup failed",
			});
		}
	} finally {
		if (pending.length > 0) {
			await putArtistOrigins(pending);
			set({ cache: [...get().cache, ...pending] });
		}
		set({ running: false });
		activeController = null;
	}
}

export async function clearOriginsCache(): Promise<void> {
	activeController?.abort();
	await clearArtistOrigins();
	useOriginsStore.getState().reload();
}
