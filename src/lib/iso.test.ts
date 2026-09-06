import { describe, expect, it } from "vitest";
import { isoCountry, isoNumeric } from "./iso";

describe("isoCountry", () => {
	it("resolves known alpha-2 codes case-insensitively", () => {
		expect(isoCountry("se")).toEqual({ numeric: "752", name: "Sweden" });
		expect(isoCountry("US")).toEqual({ numeric: "840", name: "United States" });
	});

	it("returns null for null/empty/unknown codes", () => {
		expect(isoCountry(null)).toBeNull();
		expect(isoCountry("")).toBeNull();
		expect(isoCountry("ZZ")).toBeNull();
	});

	it("covers a broad set of real codes (spot checks)", () => {
		for (const [code, numeric] of [
			["BR", "076"],
			["GB", "826"],
			["JP", "392"],
			["CI", "384"],
			["CD", "180"],
			["NZ", "554"],
		] as const) {
			expect(isoCountry(code)?.numeric).toBe(numeric);
		}
	});
});

describe("isoNumeric", () => {
	it("maps codes with ISO numeric equivalents", () => {
		expect(isoNumeric("SE")).toBe("752");
	});

	it("returns null for user-assigned / non-numeric codes", () => {
		expect(isoNumeric("XK")).toBeNull();
		expect(isoNumeric(null)).toBeNull();
	});
});
