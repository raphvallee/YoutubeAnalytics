/**
 * Likes matching - BLUEPRINT §2.6: videoId first, (artist, track) fallback.
 * Likes never create their own universe: an unmatched like is simply not
 * counted, and the leaderboard renders "-" when no likes dataset exists.
 */

import type { LikedTrack, StreamRecord } from "@/db/types";
import { trackKeyOf } from "@/ingestion/titleParse";

export interface LikesMatch {
	/** artistKey -> like count (matched likes only). */
	byArtist: Map<string, number>;
	matched: number;
	unmatched: number;
	total: number;
}

export function matchLikes(
	likes: LikedTrack[],
	records: StreamRecord[],
): LikesMatch {
	const byVideoId = new Map<string, string>();
	const byIdentity = new Map<string, string>();
	for (const r of records) {
		if (r.kind !== "music" || !r.artistKey) continue;
		if (r.videoId) byVideoId.set(r.videoId, r.artistKey);
		byIdentity.set(`${r.artistKey}|${trackKeyOf(r.title)}`, r.artistKey);
	}

	const byArtist = new Map<string, number>();
	let matched = 0;
	for (const like of likes) {
		let artistKey: string | undefined;
		if (like.videoId) artistKey = byVideoId.get(like.videoId);
		if (!artistKey) {
			const channel = (like.channel ?? "").toLowerCase().trim();
			// Playlist exports sometimes name channels "Artist - Topic".
			const channelKey = channel.endsWith(" - topic")
				? channel.slice(0, -" - topic".length).trim()
				: channel;
			artistKey = byIdentity.get(`${channelKey}|${trackKeyOf(like.title)}`);
		}
		if (!artistKey) continue;
		matched += 1;
		byArtist.set(artistKey, (byArtist.get(artistKey) ?? 0) + 1);
	}

	return {
		byArtist,
		matched,
		unmatched: likes.length - matched,
		total: likes.length,
	};
}
