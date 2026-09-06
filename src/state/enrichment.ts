import { create } from "zustand";
import { allMbReleases, clearMbReleases, putMbReleases } from "@/db/db";
import type { MbRelease, StreamRecord } from "@/db/types";
import {
	buildReleaseQuery,
	fetchMbRelease,
	MB_MIN_INTERVAL_MS,
	type MbLookup,
	sleep,
} from "@/lib/musicbrainz";
import { useDatasetStore } from "@/state/dataset";

const OPTIN_KEY = "mb-enrichment-optin";

/** User-toggled opt-in for external MusicBrainz calls (persisted locally). */
export function isMbOptIn(): boolean {
	return localStorage.getItem(OPTIN_KEY) === "1";
}
export function setMbOptIn(on: boolean): void {
	if (on) localStorage.setItem(OPTIN_KEY, "1");
	else localStorage.removeItem(OPTIN_KEY);
}

interface EnrichmentState {
	cache: MbRelease[];
	running: boolean;
	progress: { done: number; total: number };
	error: string | null;
	reload: () => void;
	/** Enrich unattributed Release-Topic channelIds (1 req/s, cancelable). */
	run: (signal: AbortSignal) => Promise<void>;
}

export const useEnrichmentStore = create<EnrichmentState>((set, get) => ({
	cache: [],
	running: false,
	progress: { done: 0, total: 0 },
	error: null,
	reload: () => {
		void allMbReleases().then((cache) => set({ cache }));
	},
	run: async (signal) => {
		if (get().running) return;
		const records = useDatasetStore.getState().records;
		const targets = enrichmentTargets(records, get().cache);
		if (targets.length === 0) {
			set({ progress: { done: 0, total: 0 }, error: null });
			return;
		}

		set({
			running: true,
			error: null,
			progress: { done: 0, total: targets.length },
		});
		const resolved: MbRelease[] = [];
		try {
			for (let i = 0; i < targets.length; i++) {
				signal.throwIfAborted();
				const target = targets[i];
				if (!target) break;
				let lookup: MbLookup | null = null;
				try {
					lookup = await fetchMbRelease(target.query, signal);
				} finally {
					// MusicBrainz etiquette: pace every request, hit or miss.
					await sleep(MB_MIN_INTERVAL_MS, signal);
				}
				resolved.push({
					channelId: target.channelId,
					releaseName: lookup?.releaseName ?? null,
					artistName: lookup?.artistName ?? null,
					date: lookup?.date ?? null,
					query: target.query,
					resolvedAt: Date.now(),
				});
				set({ progress: { done: i + 1, total: targets.length } });
				// Persist in small batches so partial progress survives a cancel.
				if (resolved.length % 5 === 0) {
					await putMbReleases(resolved.splice(0, resolved.length));
				}
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === "AbortError")) {
				set({
					error:
						err instanceof Error ? err.message : "MusicBrainz lookup failed",
				});
			}
		} finally {
			if (resolved.length > 0) await putMbReleases(resolved);
			set({ cache: await allMbReleases(), running: false });
		}
	},
}));

export interface EnrichmentTarget {
	channelId: string;
	/** Most-played track title under this channelId - the search text. */
	query: string;
}

/**
 * Unattributed "Release - Topic" channelIds not yet cached, each with the
 * most common cleaned track title as the release search text (§2.5: all
 * tracks of one release upload share the channelId).
 */
export function enrichmentTargets(
	records: StreamRecord[],
	cache: MbRelease[],
): EnrichmentTarget[] {
	const cached = new Set(cache.map((c) => c.channelId));
	const titleCounts = new Map<string, Map<string, number>>();
	for (const r of records) {
		if (r.kind !== "music" || r.artistKey || !r.channelId) continue;
		if (r.channel !== "Release - Topic") continue;
		if (cached.has(r.channelId)) continue;
		let titles = titleCounts.get(r.channelId);
		if (!titles) {
			titles = new Map();
			titleCounts.set(r.channelId, titles);
		}
		titles.set(r.title, (titles.get(r.title) ?? 0) + 1);
	}
	const targets: EnrichmentTarget[] = [];
	for (const [channelId, titles] of titleCounts) {
		let best: string | null = null;
		let bestCount = 0;
		for (const [title, count] of titles) {
			if (count > bestCount) {
				best = title;
				bestCount = count;
			}
		}
		if (best) targets.push({ channelId, query: buildReleaseQuery(best) });
	}
	return targets;
}

export async function clearEnrichmentCache(): Promise<void> {
	await clearMbReleases();
	useEnrichmentStore.getState().reload();
}
