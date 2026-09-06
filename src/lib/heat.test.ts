import { describe, expect, it } from "vitest";
import { HEAT_RAMP, heatIntensities, rampColor } from "./heat";

function brightness(hex: string): number {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return r + g + b;
}

describe("rampColor", () => {
	it("returns the ramp endpoints at t = 0 and t = 1", () => {
		expect(rampColor(0)).toBe(HEAT_RAMP[0]);
		expect(rampColor(1)).toBe(HEAT_RAMP[3]);
	});

	it("clamps out-of-range t to the ramp ends", () => {
		expect(rampColor(-2)).toBe(HEAT_RAMP[0]);
		expect(rampColor(2)).toBe(HEAT_RAMP[3]);
	});

	it("interpolates between two stops, never leaving the ramp range", () => {
		const lo = brightness(HEAT_RAMP[1] ?? "#000000");
		const hi = brightness(HEAT_RAMP[2] ?? "#000000");
		const mid = brightness(rampColor(0.5));
		expect(Math.min(lo, hi) < mid && mid < Math.max(lo, hi)).toBe(true);
	});

	it("brightens monotonically across the whole ramp", () => {
		let prev = -1;
		for (let i = 0; i <= 10; i++) {
			const b = brightness(rampColor(i / 10));
			expect(b).toBeGreaterThanOrEqual(prev);
			prev = b;
		}
	});
});

describe("heatIntensities", () => {
	it("normalizes the max to 1 with sqrt scaling", () => {
		expect(heatIntensities([2, 8])).toEqual([0.5, 1]);
	});

	it("is empty-safe and all-zero-safe", () => {
		expect(heatIntensities([])).toEqual([]);
		expect(heatIntensities([0, 0])).toEqual([0, 0]);
	});

	it("clamps negative weights to 0", () => {
		expect(heatIntensities([4, -2])).toEqual([1, 0]);
	});
});
