/**
 * Release leaderboard (Phase 6): MusicBrainz-enriched "Release - Topic"
 * channelIds joined to play counts at read time. Streams are never mutated;
 * the join happens per render over the in-memory cache.
 */
import type { MbRelease, StreamRecord } from "@/db/types";
import { inRange, type QueryOptions, type Range } from "./queries";

export interface ReleaseAgg {
	channelId: string;
	releaseName: string;
	artistName: string | null;
	date: string | null;
	plays: number;
}

/**
 * Play counts per enriched release. Only resolved lookups (releaseName
 * non-null) surface; unresolved channelIds stay hidden until enrichment
 * finds a match.
 */
export function topReleases(
	records: StreamRecord[],
	releases: MbRelease[],
	range: Range,
	opts: QueryOptions = {},
): ReleaseAgg[] {
	const byChannel = new Map<string, MbRelease>();
	for (const rel of releases) {
		if (rel.releaseName) byChannel.set(rel.channelId, rel);
	}
	const plays = new Map<string, number>();
	for (const r of records) {
		if (r.kind !== "music" || !r.channelId || !inRange(r, range, opts))
			continue;
		if (!byChannel.has(r.channelId)) continue;
		plays.set(r.channelId, (plays.get(r.channelId) ?? 0) + 1);
	}
	const out: ReleaseAgg[] = [];
	for (const [channelId, count] of plays) {
		const rel = byChannel.get(channelId);
		if (!rel) continue;
		out.push({
			channelId,
			releaseName: rel.releaseName ?? "",
			artistName: rel.artistName,
			date: rel.date,
			plays: count,
		});
	}
	return out.sort(
		(a, b) => b.plays - a.plays || a.releaseName.localeCompare(b.releaseName),
	);
}
