/**
 * Channel attribution - which rows may be credited to a real channel.
 *
 * Takeout writes one `subtitles` entry per surface that produced the row. For
 * a real video watch that surface is the channel, and its `url` is always the
 * channel page (`/channel/UC...`), so `channelId` is non-null. Two other row
 * shapes reach the same field and used to be ranked as if they were channels:
 *
 * 1. Rows with no subtitles at all - deleted videos ("Vous avez regardé une
 *    vidéo qui a été supprimée"), ad clicks, metadata Google stripped. These
 *    landed in a single `(unknown channel)` bucket that topped the leaderboard.
 * 2. System rows whose first subtitle is a localized platform string instead of
 *    a channel, e.g. `"Des recommandations basées sur la position ont été
 *    fournies"` (429 rows in the 2022-2025 export) or survey answers
 *    (`"Réponse : Adobe Studio"`). They carry no subtitle url (so no
 *    `channelId`) and no `titleUrl` (so no `videoId`).
 *
 * The test below is structural rather than a blocklist of French strings, so it
 * holds for any export locale: across two real exports (16,556 and 40,410
 * youtube rows) it matches only shape 2, and no real channel row ever matches
 * it - a name with no channel id still carries the video it was watched on.
 */

import type { StreamRecord } from "@/db/types";

/** Display name for a channel row whose id is known but whose name is not. */
export const UNKNOWN_CHANNEL_LABEL = "(unknown channel)";

/**
 * True when the row can be credited to a real channel.
 *
 * A channel id is authoritative. Without one, the row only counts if it is an
 * actual watch (it has a video id) *and* carries a channel name - that keeps
 * name-only channels, whose subtitle url is not a `/channel/UC...` path,
 * working while excluding Takeout's system strings.
 */
export function isChannelRow(r: StreamRecord): boolean {
	if (r.channelId) return true;
	return r.channel !== null && r.videoId !== null;
}

/**
 * Grouping key for a channel row: the id when known (so a renamed channel stays
 * one row), else the display name. Callers must have filtered with
 * `isChannelRow` first, otherwise a row with neither collapses onto the
 * `UNKNOWN_CHANNEL_LABEL` bucket.
 */
export function channelKeyOf(r: StreamRecord): string {
	return r.channelId ?? r.channel ?? UNKNOWN_CHANNEL_LABEL;
}

/** Display name for a channel row; falls back to the id-less label. */
export function channelNameOf(r: StreamRecord): string {
	return r.channel ?? UNKNOWN_CHANNEL_LABEL;
}
