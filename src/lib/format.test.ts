import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
	it("pads minutes to two digits when hours are present", () => {
		expect(formatDuration(6720)).toBe("1h 52m");
		expect(formatDuration(1602480)).toBe("445h 08m");
		expect(formatDuration(476460)).toBe("132h 21m");
		expect(formatDuration(497040)).toBe("138h 04m");
	});

	it("keeps single-unit durations unpadded", () => {
		expect(formatDuration(3600)).toBe("1h");
		expect(formatDuration(2700)).toBe("45m");
		expect(formatDuration(300)).toBe("5m");
		expect(formatDuration(12)).toBe("12s");
	});

	it("handles invalid and non-positive input", () => {
		expect(formatDuration(0)).toBe("0s");
		expect(formatDuration(-5)).toBe("0s");
		expect(formatDuration(Number.NaN)).toBe("0s");
	});
});
