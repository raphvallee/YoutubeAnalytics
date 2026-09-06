/**
 * Title cleaning and artist recovery from video titles.
 * docs/BLUEPRINT.md §2.4 (steps 3-4).
 */

/** Parenthesized/bracketed noise that never identifies a track. */
const NOISE_PATTERN =
	/[([]\s*(official\s+(music\s+)?(video|audio)|lyric[s]?\s+video|lyrics?|audio|video\s+oficial|video|hd|hq|4k|explicit|remaster(ed)?(\s+\d{4})?|visualizer)\s*[)\]]/gi;

/** `feat.` / `ft.` separators - kept in display titles, stripped from track keys. */
const FEAT_PATTERN = /[([]?\s*(?:feat|ft|featuring)\.?\s+[^)\]]*[)\]]?/gi;

export function artistKeyOf(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "") // strip diacritics for grouping
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Remove noise decorations; keeps `feat.` info in the display title. */
export function stripDecorations(title: string): string {
	return (
		title
			.replace(NOISE_PATTERN, "")
			.replace(/\s{2,}/g, " ")
			// Matches "Artist - Track" and the en-dash separator variant
			// (real Takeout titles use both) via unicode escape, so no
			// literal dash character lives in source.
			.replace(/\s+[\u2013-]\s*$/, "")
			.trim()
	);
}

/** Grouping key for tracks: decorations AND feat parts removed. */
export function trackKeyOf(displayTitle: string): string {
	return artistKeyOf(
		stripDecorations(displayTitle).replace(FEAT_PATTERN, "").trim(),
	);
}

/**
 * Recover "Artist - Track" from a cleaned title.
 * `channelHint` is the topic-channel artist when available (not "Release"),
 * used to disambiguate A - B vs B - A; otherwise left side is assumed artist
 * (dominant convention on Vevo/official uploads).
 */
export function parseArtistFromTitle(
	cleanedTitle: string,
	channelHint?: string | null,
): { artist: string; track: string } | null {
	const match = /^(.{1,80}?)\s+[---]\s+(.{1,80})$/.exec(cleanedTitle);
	const left = match?.[1]?.trim();
	const right = match?.[2]?.trim();
	if (!left || !right) return null;

	if (channelHint) {
		const hintKey = artistKeyOf(channelHint);
		if (hintKey && artistKeyOf(left) === hintKey)
			return { artist: left, track: right };
		if (hintKey && artistKeyOf(right) === hintKey)
			return { artist: right, track: left };
	}
	// Heuristic: feat parts usually live on the track side, so prefer a left
	// side without parentheses/brackets as the artist.
	if (left.includes("(") && !right.includes("("))
		return { artist: right, track: left };
	return { artist: left, track: right };
}

/**
 * Artist from an auto-generated Topic channel. Returns null when the channel
 * is the poisoned "Release - Topic" (YouTube strips the artist there) -
 * docs/BLUEPRINT.md §2.4 step 3a guard.
 */
export function artistFromTopicChannel(channel: string): string | null {
	if (!channel.endsWith(" - Topic")) return null;
	const artist = channel.slice(0, -" - Topic".length).trim();
	if (!artist || artist.toLowerCase() === "release") return null;
	return artist;
}
