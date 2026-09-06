import { describe, expect, it } from "vitest";
import { buildArtistQuery, parseArtistResponse } from "./mbArtist";

describe("buildArtistQuery", () => {
	it("quotes and trims the artist name", () => {
		expect(buildArtistQuery(" Daft Punk ")).toBe('artist:"Daft Punk"');
	});
});

describe("parseArtistResponse", () => {
	it("parses a full hit with begin area and country", () => {
		const hit = parseArtistResponse({
			artists: [
				{
					id: "mbid-1",
					name: "John Fred",
					type: "Person",
					country: "US",
					"begin-area": { id: "a1", name: "Baton Rouge" },
					area: { name: "United States" },
				},
			],
		});
		expect(hit).toEqual({
			mbid: "mbid-1",
			name: "John Fred",
			type: "Person",
			country: "US",
			beginAreaName: "Baton Rouge",
			areaName: "United States",
		});
	});

	it("tolerates absent begin-area, country and type (common for groups)", () => {
		const hit = parseArtistResponse({
			artists: [{ id: "mbid-2", name: "Band" }],
		});
		expect(hit).toEqual({
			mbid: "mbid-2",
			name: "Band",
			type: null,
			country: null,
			beginAreaName: null,
			areaName: null,
		});
	});

	it("keeps the area as a fallback when begin-area is absent", () => {
		const hit = parseArtistResponse({
			artists: [
				{
					id: "mbid-4",
					name: "Band",
					area: { id: "a2", name: "Sweden" },
				},
			],
		});
		expect(hit?.beginAreaName).toBeNull();
		expect(hit?.areaName).toBe("Sweden");
	});

	it("rejects a non-2-letter country code", () => {
		expect(
			parseArtistResponse({
				artists: [{ id: "mbid-3", name: "X", country: "USA" }],
			})?.country,
		).toBeNull();
	});

	it("returns null on empty artist list", () => {
		expect(parseArtistResponse({ artists: [] })).toBeNull();
	});

	it("returns null on junk input", () => {
		expect(parseArtistResponse(null)).toBeNull();
		expect(parseArtistResponse({})).toBeNull();
		expect(parseArtistResponse({ artists: [{ name: "no id" }] })).toBeNull();
		expect(
			parseArtistResponse({ artists: [{ id: "x", name: "" }] }),
		).toBeNull();
	});
});
