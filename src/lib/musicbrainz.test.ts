import { describe, expect, it } from "vitest";
import { buildReleaseQuery, parseReleaseResponse } from "./musicbrainz";

describe("buildReleaseQuery", () => {
	it("quotes the title for an exact-ish release search", () => {
		expect(buildReleaseQuery(" Mask Off ")).toBe('release:"Mask Off"');
	});
});

describe("parseReleaseResponse", () => {
	it("extracts title, credited artist, and date", () => {
		const parsed = parseReleaseResponse({
			releases: [
				{
					title: "DS2",
					date: "2015-07-16",
					"artist-credit": [{ artist: { name: "Future" } }],
				},
			],
		});
		expect(parsed).toEqual({
			releaseName: "DS2",
			artistName: "Future",
			date: "2015-07-16",
		});
	});

	it("falls back to the credit-level name when no artist entity", () => {
		const parsed = parseReleaseResponse({
			releases: [{ title: "X", "artist-credit": [{ name: "Various" }] }],
		});
		expect(parsed?.artistName).toBe("Various");
	});

	it("returns null on an empty hit list or blank titles", () => {
		expect(parseReleaseResponse({ releases: [] })).toBeNull();
		expect(parseReleaseResponse({})).toBeNull();
		expect(parseReleaseResponse({ releases: [{ title: "" }] })).toBeNull();
	});
});
