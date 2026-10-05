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

/**
 * How long a resolved origin is trusted before it is looked up again.
 *
 * MusicBrainz data is not frozen: artists get a begin_area filled in, names
 * get corrected, an ambiguous match gets superseded. So a cached row is
 * refreshed eventually rather than kept forever - but the window has to be
 * wide enough that ordinary use (reload, re-import, revisit) never spends a
 * request, which is what makes the cache worth having at all.
 *
 * Six months is a compromise: long enough that a normal return visit hits
 * the cache, short enough that a year-old miss gets another chance.
 */
export const ORIGIN_TTL_MONTHS = 6;
const AVG_MONTH_MS = (365.25 / 12) * 24 * 60 * 60 * 1000;
export const ORIGIN_TTL_MS = Math.round(ORIGIN_TTL_MONTHS * AVG_MONTH_MS);

/**
 * Is this cached row due for a refetch? A row from the future (clock skew,
 * a restore from a backup) counts as fresh rather than being refetched on
 * every load forever.
 */
export function isOriginStale(row: ArtistOrigin, now: number): boolean {
	return now - row.resolvedAt >= ORIGIN_TTL_MS;
}

export interface OriginTarget {
	artistKey: string;
	artist: string;
	plays: number;
}

/**
 * Every attributed music artist over ALL records (the map is all-time by
 * definition), ranked by plays desc, minus the artistKeys already cached.
 *
 * `now` is injected rather than read from the clock so the staleness cutoff
 * is testable. A cached row still inside the TTL is skipped; an older one is
 * returned as a target again, so it gets refetched while remaining on the map
 * (the caller overwrites in place, no blanking).
 */
export function originTargets(
	records: StreamRecord[],
	cache: ArtistOrigin[],
	now: number = Date.now(),
): OriginTarget[] {
	const cached = new Set(
		cache.filter((c) => !isOriginStale(c, now)).map((c) => c.artistKey),
	);
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
		// Hydrate the cache from Dexie before computing targets: a
		// just-opened app may start the run before reload() resolves, and
		// stale-empty targets would re-query already-cached artists.
		void (async () => {
			const cache = await allArtistOrigins();
			if (get().running) return;
			set({ cache });
			// Records are read after the await, not before: an import may
			// land during the Dexie read and change the lifetime plays these
			// targets are ranked by.
			const records = useDatasetStore.getState().records;
			if (records.length === 0) return;
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
	// The queue is re-derived, never iterated as a frozen snapshot: a run is
	// paced at 1 req/s, so a long one routinely outlives an import. Comparing
	// `records` by reference is a reliable "dataset changed" signal because
	// `reload()` always sets a freshly-read array.
	let recordsRef = useDatasetStore.getState().records;
	let queue = originTargets(recordsRef, get().cache);
	let i = 0;
	let done = 0;
	set({
		running: true,
		error: null,
		progress: { done, total: queue.length },
	});
	try {
		while (true) {
			if (i >= queue.length) {
				// Queue drained. Before declaring victory, check whether an
				// import replaced the dataset while we were running - the
				// trigger from App.tsx was dropped by `start()`'s already-running
				// guard, so this re-check is the only thing that picks up the
				// new artists (re-ranked by their updated lifetime plays).
				const records = useDatasetStore.getState().records;
				if (records === recordsRef) break;
				recordsRef = records;
				queue = originTargets(records, get().cache);
				i = 0;
				set({ progress: { done, total: done + queue.length } });
				continue;
			}
			signal.throwIfAborted();
			const target = queue[i];
			if (!target) break;
			i += 1;

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

			const row: ArtistOrigin = {
				artistKey: target.artistKey,
				artistName: target.artist,
				resolvedAt: Date.now(),
				...originFromLookups(mb, geo, centroid),
			};
			done += 1;
			// `total` counts known work outstanding, so it grows when an
			// import adds artists mid-run instead of leaving done > total.
			set({ progress: { done, total: done + queue.length - i } });
			// Persist every row as soon as it resolves, and grow the cache in
			// the same step, so the map fills in while a long run is going.
			//
			// One write per artist, not a batch: a run is paced at 1 req/s, so
			// the write is free next to the request it follows. Buffering was
			// what made a reload throw work away - a reload unmounts the page
			// without running `finally`, so every row still sitting in the
			// buffer was lost and re-queried from scratch on the next load,
			// which is exactly the restart this is meant to avoid.
			await putArtistOrigins([row]);
			set({ cache: upsertOrigin(get().cache, row) });
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
		// Nothing to flush: every row is already durable (see the write in
		// the loop), so an abort at any point keeps the work done so far.
		set({ running: false });
		activeController = null;
	}
}

/**
 * Replace the cache entry for one artistKey, or append it if absent.
 *
 * A TTL refresh re-resolves an artist that is *already* in the cache, so a
 * blind append would leave two rows under one key: the map would double-count
 * that artist's plays and the table would list them twice. Dexie's bulkPut
 * overwrites by primary key; this keeps the in-memory mirror honest.
 */
function upsertOrigin(
	cache: ArtistOrigin[],
	row: ArtistOrigin,
): ArtistOrigin[] {
	const i = cache.findIndex((c) => c.artistKey === row.artistKey);
	if (i === -1) return [...cache, row];
	const next = [...cache];
	next[i] = row;
	return next;
}

export async function clearOriginsCache(): Promise<void> {
	activeController?.abort();
	await clearArtistOrigins();
	useOriginsStore.getState().reload();
}
