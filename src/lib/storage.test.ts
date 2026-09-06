import { describe, expect, it } from "vitest";
import { formatBytes } from "./storage";

describe("formatBytes", () => {
	it.each([
		[0, "0 B"],
		[512, "512 B"],
		[1024, "1.0 KB"],
		[1024 * 1024, "1.0 MB"],
		[1.4 * 1024 * 1024, "1.4 MB"],
		[3.5 * 1024 ** 3, "3.5 GB"],
		[-5, "0 B"],
	])("formats %d as %s", (bytes, expected) => {
		expect(formatBytes(bytes)).toBe(expected);
	});
});
