/**
 * Snapshot compare (Phase 6): totals of the active snapshot vs the live
 * dataset, joined on artistKey. Deltas are arrows + percentages, never
 * color-alone.
 */
import type { StreamRecord } from "@/db/types";
import { type QueryOptions, type Range, topArtists } from "./queries";

/** Total organic plays per artistKey in range (unattributed excluded). */
export function playsByArtistKey(
	records: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const r of records) {
		if (r.kind !== "music" || !r.artistKey) continue;
		if (r.ts < range.from || r.ts > range.to) continue;
		if (!opts.includeAds && r.adDriven) continue;
		counts.set(r.artistKey, (counts.get(r.artistKey) ?? 0) + 1);
	}
	return counts;
}

export interface ArtistDelta {
	/** Plays in the snapshot, for the same artist. */
	snap: number;
	/**
	 * Relative change vs snapshot: (current - snap) / snap.
	 * null = artist absent from the snapshot ("new").
	 */
	pct: number | null;
}

/** Join current leaderboard rows with snapshot plays, by artistKey. */
export function compareArtists(
	current: Array<{ artistKey: string; plays: number }>,
	snapshotRecords: StreamRecord[],
	range: Range,
	opts: QueryOptions = {},
): Map<string, ArtistDelta> {
	const snapMap = playsByArtistKey(snapshotRecords, range, opts);
	const out = new Map<string, ArtistDelta>();
	for (const a of current) {
		const snap = snapMap.get(a.artistKey);
		out.set(a.artistKey, {
			snap: snap ?? 0,
			pct:
				snap === undefined ? null : snap > 0 ? (a.plays - snap) / snap : null,
		});
	}
	return out;
}

/** Re-export so callers don't import queries twice for one job. */
export { topArtists };
