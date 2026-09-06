import { describe, expect, it } from "vitest";
import { isSearchTitle, stripTitlePrefix } from "./prefixes";
import {
	artistFromTopicChannel,
	artistKeyOf,
	parseArtistFromTitle,
	stripDecorations,
	trackKeyOf,
} from "./titleParse";

describe("stripTitlePrefix", () => {
	it("strips the French watch prefix (real export locale)", () => {
		const r = stripTitlePrefix("Vous avez regardé Old Hundreds");
		expect(r).toEqual({
			type: "stream",
			title: "Old Hundreds",
			prefix: "Vous avez regardé ",
		});
	});

	it("strips English and German prefixes", () => {
		expect(stripTitlePrefix("Watched Some Video")).toMatchObject({
			type: "stream",
			title: "Some Video",
		});
		expect(stripTitlePrefix("Angesehen: Ein Video")).toMatchObject({
			type: "stream",
			title: "Ein Video",
		});
	});

	it("classifies search rows", () => {
		expect(stripTitlePrefix("Vous avez recherché takeout json")).toMatchObject({
			type: "search",
		});
	});

	it("returns unknown type with untouched title for untable locales", () => {
		const r = stripTitlePrefix("Assisti to Something");
		expect(r.type).toBe("unknown");
		if (r.type === "unknown") expect(r.title).toBe("Assisti to Something");
	});

	it("handles the loose CJK watch marker", () => {
		const r = stripTitlePrefix("曲を視聴しましたTrack Name");
		expect(r.type).toBe("stream");
		if (r.type === "stream") expect(r.title).toBe("Track Name");
	});
});

describe("isSearchTitle", () => {
	it("detects prefixed and embedded search markers", () => {
		expect(isSearchTitle("Searched youtube api")).toBe(true);
		expect(isSearchTitle("Vous avez recherché x")).toBe(true);
		expect(isSearchTitle("Vous avez regardé x")).toBe(false);
	});
});

describe("artistFromTopicChannel", () => {
	it("strips the Topic suffix", () => {
		expect(artistFromTopicChannel("Future - Topic")).toBe("Future");
	});

	it("refuses the poisoned Release - Topic channel", () => {
		expect(artistFromTopicChannel("Release - Topic")).toBeNull();
	});

	it("returns null for plain channels", () => {
		expect(artistFromTopicChannel("Some Uploader")).toBeNull();
	});
});

describe("parseArtistFromTitle", () => {
	it("assumes left side is artist without a hint", () => {
		expect(parseArtistFromTitle("Future - Mask Off")).toEqual({
			artist: "Future",
			track: "Mask Off",
		});
	});

	it("prefers the side matching the channel hint", () => {
		expect(parseArtistFromTitle("Mask Off - Future", "Future")).toEqual({
			artist: "Future",
			track: "Mask Off",
		});
	});

	it("moves parenthesized left side to the track", () => {
		expect(
			parseArtistFromTitle("Training Season (feat. Someone) - Dua Lipa"),
		).toEqual({
			artist: "Dua Lipa",
			track: "Training Season (feat. Someone)",
		});
	});

	it("returns null when no dash separator exists", () => {
		expect(parseArtistFromTitle("Old Hundreds")).toBeNull();
	});
});

describe("stripDecorations / trackKeyOf", () => {
	it("strips official-video noise", () => {
		expect(stripDecorations("Training Season (Official Video)")).toBe(
			"Training Season",
		);
		expect(stripDecorations("Song [Official Audio]")).toBe("Song");
	});

	it("keeps feat in display but strips it from the track key", () => {
		const display = stripDecorations("Song (feat. Other Artist)");
		expect(display).toBe("Song (feat. Other Artist)");
		expect(trackKeyOf(display)).toBe("song");
	});

	it("normalizes artist keys (case, diacritics, whitespace)", () => {
		expect(artistKeyOf("  Beyoncé   Giselle ")).toBe("beyonce giselle");
	});
});
