import { describe, expect, it } from "vitest";
import {
	buildGeocodeUrl,
	classifyPrecision,
	type GeoHit,
	parseGeocodeResponse,
} from "./geocode";

describe("buildGeocodeUrl", () => {
	it("encodes the name and omits the country filter when null", () => {
		expect(buildGeocodeUrl("New York", null)).toBe(
			"https://geocoding-api.open-meteo.com/v1/search?name=New%20York&count=1&language=en&format=json",
		);
	});

	it("appends the country filter when given", () => {
		expect(buildGeocodeUrl("Paris", "FR")).toContain("&countryCode=FR");
	});
});

describe("parseGeocodeResponse", () => {
	it("parses the first result", () => {
		const hit = parseGeocodeResponse({
			results: [
				{
					id: 1,
					name: "Berlin",
					latitude: 52.52,
					longitude: 13.4,
					country: "Germany",
					country_code: "DE",
					admin1: "Berlin",
					feature_code: "PPLC",
				},
				{ name: "Berlin (second)", latitude: 1, longitude: 1 },
			],
		});
		expect(hit).toEqual({
			name: "Berlin",
			latitude: 52.52,
			longitude: 13.4,
			country: "Germany",
			countryCode: "DE",
			admin1: "Berlin",
			featureCode: "PPLC",
		});
	});

	it("returns null when results are absent (no match)", () => {
		expect(parseGeocodeResponse({})).toBeNull();
		expect(parseGeocodeResponse({ results: [] })).toBeNull();
		expect(parseGeocodeResponse(null)).toBeNull();
	});

	it("returns null on malformed coordinates", () => {
		expect(
			parseGeocodeResponse({ results: [{ name: "X", latitude: "52" }] }),
		).toBeNull();
	});
});

describe("classifyPrecision", () => {
	const hit = (over: Partial<GeoHit>): GeoHit => ({
		name: "Place",
		latitude: 0,
		longitude: 0,
		country: null,
		countryCode: null,
		admin1: null,
		featureCode: null,
		...over,
	});

	it("feature codes starting with ADM are subdivisions", () => {
		expect(classifyPrecision(hit({ featureCode: "ADM1" }), "Bavaria")).toBe(
			"subdivision",
		);
	});

	it("a city inside a same-named region is still a city (PPLC wins)", () => {
		expect(
			classifyPrecision(
				hit({ featureCode: "PPLC", admin1: "Stockholm" }),
				"Stockholm",
			),
		).toBe("city");
	});

	it("admin1 equal to the searched name implies a subdivision", () => {
		expect(
			classifyPrecision(hit({ admin1: "Île-de-France" }), "île-de-france "),
		).toBe("subdivision");
	});

	it("plain populated places are cities", () => {
		expect(
			classifyPrecision(hit({ featureCode: "PPL", admin1: "Texas" }), "Austin"),
		).toBe("city");
	});
});
