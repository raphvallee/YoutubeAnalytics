import { describe, expect, it } from "vitest";
import type { StreamRecord } from "@/db/types";
import {
	channelKeyOf,
	channelNameOf,
	isChannelRow,
	UNKNOWN_CHANNEL_LABEL,
} from "./channelAttribution";

const row = (p: Partial<StreamRecord>): StreamRecord => ({
	id: "x",
	ts: 0,
	kind: "youtube",
	videoId: null,
	title: "t",
	rawTitle: "r",
	artist: null,
	artistKey: "",
	artistConfidence: "unknown",
	channel: null,
	channelId: null,
	adDriven: false,
	...p,
});

describe("isChannelRow", () => {
	it("accepts a row with a channel id, whatever else is missing", () => {
		expect(isChannelRow(row({ channelId: "UCabc" }))).toBe(true);
		// The id is authoritative, so a missing name is still a channel.
		expect(isChannelRow(row({ channelId: "UCabc", videoId: null }))).toBe(true);
	});

	it("accepts a name-only channel when a video backs the row", () => {
		expect(isChannelRow(row({ channel: "Some Channel", videoId: "v1" }))).toBe(
			true,
		);
	});

	it("rejects rows with no channel and no video", () => {
		// The shape behind the old `(unknown channel)` bucket: deleted videos,
		// ad clicks, metadata Google stripped.
		expect(isChannelRow(row({}))).toBe(false);
		expect(isChannelRow(row({ videoId: "v1" }))).toBe(false);
	});

	it("rejects Takeout system rows that only name a platform string", () => {
		// Real French export rows: a name, no subtitle url (so no channel id)
		// and no titleUrl (so no video id). These are not channels.
		expect(
			isChannelRow(
				row({
					channel:
						"Des recommandations basées sur la position ont été fournies",
				}),
			),
		).toBe(false);
		expect(isChannelRow(row({ channel: "Réponse : Adobe Studio" }))).toBe(
			false,
		);
	});

	it("is locale-independent: the rule never reads the channel name", () => {
		// Whatever the string is, the decision comes from the id/video pair.
		const pseudo = row({ channel: "Location-based recommendations provided" });
		expect(isChannelRow(pseudo)).toBe(false);
		expect(isChannelRow({ ...pseudo, videoId: "v1" })).toBe(true);
	});
});

describe("channelKeyOf / channelNameOf", () => {
	it("prefers the id as key and the name as label", () => {
		const r = row({ channel: "Alpha", channelId: "UCa" });
		expect(channelKeyOf(r)).toBe("UCa");
		expect(channelNameOf(r)).toBe("Alpha");
	});

	it("falls back to the name when there is no id", () => {
		const r = row({ channel: "Alpha", videoId: "v1" });
		expect(channelKeyOf(r)).toBe("Alpha");
	});

	it("uses the shared label when a row has an id but no name", () => {
		const r = row({ channelId: "UCa" });
		expect(channelNameOf(r)).toBe(UNKNOWN_CHANNEL_LABEL);
	});
});
