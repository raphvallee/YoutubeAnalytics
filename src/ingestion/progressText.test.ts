import { describe, expect, it } from "vitest";
import type { IngestProgress } from "./ingestClient";
import { progressText } from "./progressText";

describe("progressText", () => {
	it("renders the 0-based file index as a 1-based position", () => {
		expect(
			progressText({ phase: "read", fileIndex: 0, fileCount: 3 }).title,
		).toBe("Reading file… (file 1 of 3)");
		expect(
			progressText({ phase: "normalize", fileIndex: 2, fileCount: 3 }).title,
		).toBe("Parsing & normalizing… (file 3 of 3)");
	});

	it("never prints a position for a single-file batch", () => {
		expect(
			progressText({ phase: "read", fileIndex: 0, fileCount: 1 }).title,
		).toBe("Reading file… (file 1 of 1)");
		expect(
			progressText({ phase: "normalize", fileIndex: 0, fileCount: 1 }).title,
		).toBe("Parsing & normalizing… (file 1 of 1)");
	});

	it("drops the file counter while persisting, which is not per file", () => {
		const persist = progressText({
			phase: "persist",
			fileIndex: null,
			fileCount: 3,
			rows: 9,
		});
		expect(persist.title).toBe("Writing to local database…");
		expect(persist.title).not.toContain("file");
		expect(persist.detail).toBe("9 streams to write");
	});

	it("scopes the row count to the file being parsed", () => {
		expect(
			progressText({
				phase: "normalize",
				fileIndex: 1,
				fileCount: 3,
				rows: 12,
			}).detail,
		).toBe("12 streams from this file");
	});

	it("omits the detail line until a row count exists", () => {
		expect(
			progressText({ phase: "read", fileIndex: 0, fileCount: 2 }).detail,
		).toBeNull();
		expect(
			progressText({ phase: "persist", fileIndex: null, fileCount: 2 }).detail,
		).toBeNull();
	});

	it("never renders a position beyond the batch", () => {
		const events: IngestProgress[] = [
			{ phase: "read", fileIndex: 0, fileCount: 2 },
			{ phase: "normalize", fileIndex: 0, fileCount: 2 },
			{ phase: "read", fileIndex: 1, fileCount: 2 },
			{ phase: "normalize", fileIndex: 1, fileCount: 2 },
			{ phase: "persist", fileIndex: null, fileCount: 2, rows: 5 },
		];
		for (const event of events) {
			const match = /file (\d+) of (\d+)/.exec(progressText(event).title);
			if (!match) continue;
			const position = Number(match[1]);
			const total = Number(match[2]);
			expect(position).toBeGreaterThanOrEqual(1);
			expect(position).toBeLessThanOrEqual(total);
		}
	});
});
