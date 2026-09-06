import { describe, expect, it } from "vitest";
import { countryCentroid, worldFeatures } from "./geo";

describe("worldFeatures", () => {
	it("decodes a plausible number of 110m country features", () => {
		expect(worldFeatures.length).toBeGreaterThan(150);
		expect(worldFeatures.length).toBeLessThan(200);
	});

	it("drops Antarctica (numeric id 010)", () => {
		expect(worldFeatures.some((f) => String(f.id) === "010")).toBe(false);
	});
});

describe("countryCentroid", () => {
	it("places the US centroid in North America", () => {
		const c = countryCentroid("US");
		expect(c).not.toBeNull();
		expect(c?.lat).toBeGreaterThan(15);
		expect(c?.lat).toBeLessThan(65);
		expect(c?.lng).toBeLessThan(-60);
		expect(c?.lng).toBeGreaterThan(-130);
	});

	it("places Sweden in Scandinavia", () => {
		const c = countryCentroid("SE");
		expect(c).not.toBeNull();
		expect(c?.lat).toBeGreaterThan(55);
		expect(c?.lat).toBeLessThan(70);
		expect(c?.lng).toBeGreaterThan(10);
		expect(c?.lng).toBeLessThan(25);
	});

	it("is case-insensitive and null-safe", () => {
		expect(countryCentroid("br")).not.toBeNull();
		expect(countryCentroid(null)).toBeNull();
		expect(countryCentroid("XK")).toBeNull();
	});
});
