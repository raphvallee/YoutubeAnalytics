import { describe, expect, it } from "vitest";
import {
	classifyTakeoutText,
	contentSignature,
	disambiguateNames,
	looksLikeHistoryEntry,
	looksLikePlaylistEntry,
	scanArrayPrefix,
	tallyVerdicts,
} from "./detect";

/** A minimal valid Takeout history row. */
const historyEntry = (overrides?: Record<string, unknown>) => ({
	header: "YouTube Music",
	title: "Vous avez regardé Test",
	titleUrl: "https://music.youtube.com/watch?v=abc123",
	time: "2026-09-05T23:38:26.018Z",
	...overrides,
});

const json = (rows: unknown[]) => JSON.stringify(rows, null, 2);

const classify = (rows: unknown[], name = "watch-history.json") =>
	classifyTakeoutText(json(rows), name);

describe("scanArrayPrefix", () => {
	it("extracts complete elements from the head of a truncated array", () => {
		const full = json([
			historyEntry(),
			historyEntry({ time: "2026-01-01T00:00:00Z" }),
		]);
		// Cut mid-way through the second object: the first must still parse.
		const cut = full.indexOf('"time": "2026-01-01');
		const scan = scanArrayPrefix(full.slice(0, cut), 10);

		expect(scan.isArray).toBe(true);
		expect(scan.complete).toBe(false);
		expect(scan.entries).toHaveLength(1);
	});

	it("reports completion when the closing bracket is present", () => {
		const scan = scanArrayPrefix(json([historyEntry()]), 10);
		expect(scan.complete).toBe(true);
	});

	it("does not lose entries to an escaped quote inside a title", () => {
		const rows = [
			historyEntry({ title: 'Vous avez regardé "quoted" \\ title' }),
			historyEntry({ time: "2026-01-01T00:00:00Z" }),
		];
		expect(scanArrayPrefix(json(rows), 10).entries).toHaveLength(2);
	});

	it("handles a brace or bracket inside a title string", () => {
		const rows = [
			historyEntry({ title: "Vous avez regardé {live} [2024]" }),
			historyEntry({ time: "2026-01-01T00:00:00Z" }),
		];
		expect(scanArrayPrefix(json(rows), 10).entries).toHaveLength(2);
	});

	it("stops at maxEntries", () => {
		const rows = Array.from({ length: 50 }, () => historyEntry());
		expect(scanArrayPrefix(json(rows), 10).entries).toHaveLength(10);
	});

	it("reports a non-array payload", () => {
		expect(scanArrayPrefix('{"a":1}', 10).isArray).toBe(false);
		expect(scanArrayPrefix("", 10).isArray).toBe(false);
	});

	it("parses scalar elements (array of titles)", () => {
		const scan = scanArrayPrefix('["Song A","Song B"]', 10);
		expect(scan.entries).toEqual(["Song A", "Song B"]);
	});
});

describe("looksLikeHistoryEntry", () => {
	it("accepts a real row", () => {
		expect(looksLikeHistoryEntry(historyEntry())).toBe(true);
	});

	it("rejects search rows (query + time, no title)", () => {
		expect(
			looksLikeHistoryEntry({ query: "cats", time: "2026-09-05T00:00:00Z" }),
		).toBe(false);
	});

	it("rejects channel rows (title, no time)", () => {
		expect(
			looksLikeHistoryEntry({ title: "Some Channel", channelId: "UC123" }),
		).toBe(false);
	});

	it("rejects rows whose time is unparseable", () => {
		expect(looksLikeHistoryEntry(historyEntry({ time: "not a date" }))).toBe(
			false,
		);
	});

	it("rejects non-objects", () => {
		expect(looksLikeHistoryEntry("Song A")).toBe(false);
		expect(looksLikeHistoryEntry(null)).toBe(false);
	});

	it("accepts a row with no titleUrl (deleted video) but a header", () => {
		expect(
			looksLikeHistoryEntry(
				historyEntry({ titleUrl: undefined, header: "YouTube" }),
			),
		).toBe(true);
	});
});

describe("looksLikePlaylistEntry", () => {
	it("accepts playlist rows with a video id", () => {
		expect(looksLikePlaylistEntry({ videoId: "abc", title: "Track" })).toBe(
			true,
		);
		expect(
			looksLikePlaylistEntry({ "Video Id": "abc", "Video Title": "T" }),
		).toBe(true);
	});

	it("rejects bare title strings - they would manufacture unknown-track rows", () => {
		expect(looksLikePlaylistEntry("Song A")).toBe(false);
	});

	it("rejects title-only rows with no video id and no date (subscriptions)", () => {
		expect(
			looksLikePlaylistEntry({ title: "Channel A", channelId: "UC1" }),
		).toBe(false);
	});

	it("accepts title + addedAt, which is a playlist row", () => {
		expect(
			looksLikePlaylistEntry({ title: "Track", addedAt: "2024-01-01" }),
		).toBe(true);
	});
});

describe("classifyTakeoutText", () => {
	it("accepts a watch history regardless of filename", () => {
		for (const name of [
			"watch-history.json",
			"watch-history(1).json",
			"export(3).json",
			"data.json",
			"whatever-i-called-it.json",
		]) {
			expect(classify([historyEntry()], name).role).toBe("watch-history");
		}
	});

	it("accepts a history whose rows lack titleUrl", () => {
		const rows = [
			historyEntry({ header: "YouTube", titleUrl: undefined }),
			historyEntry({ header: "YouTube", titleUrl: undefined }),
		];
		expect(classify(rows).role).toBe("watch-history");
	});

	it("rejects search-history.json with an actionable reason", () => {
		const rows = [
			{ query: "cats", time: "2026-09-05T00:00:00Z" },
			{ query: "dogs", time: "2026-09-05T00:00:00Z" },
		];
		const v = classify(rows, "search-history.json");
		expect(v.role).toBe("unknown");
		expect(v.reason).toContain("search-history");
	});

	it("rejects subscriptions.json", () => {
		const rows = [
			{ title: "Channel A", description: "d", channelId: "UC1" },
			{ title: "Channel B", description: "d", channelId: "UC2" },
		];
		const v = classify(rows, "subscriptions.json");
		expect(v.role).toBe("unknown");
		expect(v.reason).toContain("subscriptions.json");
	});

	it("rejects an empty array - it must never look importable", () => {
		const v = classify([], "watch-history.json");
		expect(v.role).toBe("unknown");
		expect(v.reason).toContain("Empty file");
	});

	it("rejects an empty file", () => {
		expect(classifyTakeoutText("", "watch-history.json").role).toBe("unknown");
	});

	it("rejects an empty array in any whitespace form", () => {
		for (const text of ["[]", "  \n [ ] ", "[]\n"]) {
			expect(classifyTakeoutText(text, "watch-history.json").role).toBe(
				"unknown",
			);
		}
	});

	it("sees through a UTF-8 BOM", () => {
		const bom = `\ufeff${json([historyEntry(), historyEntry()])}`;
		expect(classifyTakeoutText(bom, "watch-history.json").role).toBe(
			"watch-history",
		);
	});

	it("rejects a JSON object payload that looks like an export", () => {
		expect(
			classifyTakeoutText('{"activities":[1,2]}', "account.json").reason,
		).toContain("Not a JSON array");
	});

	it("rejects HTML served with a .json name", () => {
		expect(
			classifyTakeoutText("<html>404</html>", "watch-history.json").role,
		).toBe("unknown");
	});

	it("rejects arrays of nulls and nested arrays", () => {
		expect(classify([null, null], "x.json").role).toBe("unknown");
		expect(
			classify(
				[
					[1, 2],
					[3, 4],
				],
				"x.json",
			).role,
		).toBe("unknown");
	});

	it("rejects a JSON object payload", () => {
		expect(
			classifyTakeoutText('{"key":"value"}', "account.json").reason,
		).toContain("Not a JSON array");
	});

	it("tolerates a minority of malformed rows in an otherwise real history", () => {
		const rows = [
			...Array.from({ length: 9 }, () => historyEntry()),
			{ title: "broken" },
		];
		expect(classify(rows).role).toBe("watch-history");
	});

	it("rejects a file that is half history, half something else", () => {
		const rows = [
			historyEntry(),
			{ query: "cats", time: "2026-09-05T00:00:00Z" },
		];
		expect(classify(rows).role).toBe("unknown");
	});

	it("routes a liked-playlist JSON export to likes", () => {
		const rows = [
			{ videoId: "a", title: "Track A" },
			{ videoId: "b", title: "Track B" },
		];
		const v = classify(rows, "Liked music.json");
		expect(v.role).toBe("playlist");
		expect(v.reason).toContain("likes");
	});

	it("routes a Takeout playlist CSV to likes", () => {
		const csv =
			"Video Id,Video Title,Channel Name,Date Created\nabc,Song,Chan,2024-01-01";
		const v = classifyTakeoutText(csv, "liked-music.csv", csv.length);
		expect(v.role).toBe("playlist");
	});

	it("does not route an unrelated CSV to likes", () => {
		const csv = "a,b\n1,2";
		expect(classifyTakeoutText(csv, "notes.csv", csv.length).role).toBe(
			"unknown",
		);
	});

	it("classifies from a head prefix, not the whole file", () => {
		const full = json(Array.from({ length: 500 }, () => historyEntry()));
		const v = classifyTakeoutText(full.slice(0, 4096), "big.json", full.length);
		expect(v.role).toBe("watch-history");
		expect(v.size).toBe(full.length);
	});

	it("keeps the reported size even when only a prefix was scanned", () => {
		const full = json([historyEntry()]);
		const v = classifyTakeoutText(full.slice(0, 20), "big.json", 1_234_567_890);
		expect(v.size).toBe(1_234_567_890);
	});
});

describe("tallyVerdicts", () => {
	it("counts each role", () => {
		expect(
			tallyVerdicts([
				{
					name: "a",
					size: 1,
					role: "watch-history",
					reason: "",
					signature: null,
				},
				{
					name: "b",
					size: 1,
					role: "watch-history",
					reason: "",
					signature: null,
				},
				{
					name: "c",
					size: 1,
					role: "playlist",
					reason: "",
					signature: null,
				},
				{
					name: "d",
					size: 1,
					role: "unknown",
					reason: "",
					signature: null,
				},
			]),
		).toEqual({ histories: 2, playlists: 1, skipped: 1 });
	});
});

describe("contentSignature", () => {
	it("is stable for identical content", async () => {
		const a = await contentSignature(100, "head-bytes", "tail-bytes");
		const b = await contentSignature(100, "head-bytes", "tail-bytes");
		expect(a).toBe(b);
	});

	it("differs when any of size, head or tail differs", async () => {
		const base = await contentSignature(100, "head-bytes", "tail-bytes");
		expect(await contentSignature(101, "head-bytes", "tail-bytes")).not.toBe(
			base,
		);
		expect(await contentSignature(100, "head-byteS", "tail-bytes")).not.toBe(
			base,
		);
		expect(await contentSignature(100, "head-bytes", "tail-byteS")).not.toBe(
			base,
		);
	});

	it("cannot be fooled by shifting bytes across the head/tail boundary", async () => {
		const a = await contentSignature(100, "abcd", "efgh");
		const b = await contentSignature(100, "abce", "fgh");
		expect(a).not.toBe(b);
	});
});

describe("disambiguateNames", () => {
	const f = (name: string) => ({ name });

	it("leaves unique names alone", () => {
		expect(
			disambiguateNames([f("watch-history.json"), f("search-history.json")]),
		).toEqual(["watch-history.json", "search-history.json"]);
	});

	it("numbers repeats by how many files carry that exact name", () => {
		expect(
			disambiguateNames([
				f("watch-history.json"),
				f("watch-history.json"),
				f("watch-history.json"),
			]),
		).toEqual([
			"watch-history.json",
			"watch-history-2.json",
			"watch-history-3.json",
		]);
	});

	it("numbers each name group independently", () => {
		expect(
			disambiguateNames([
				f("watch-history.json"),
				f("search-history.json"),
				f("watch-history.json"),
				f("search-history.json"),
			]),
		).toEqual([
			"watch-history.json",
			"search-history.json",
			"watch-history-2.json",
			"search-history-2.json",
		]);
	});

	it("keeps the extension intact, including multi-dot names", () => {
		expect(disambiguateNames([f("a.b.json"), f("a.b.json")])).toEqual([
			"a.b.json",
			"a.b-2.json",
		]);
	});

	it("handles a name with no extension", () => {
		expect(disambiguateNames([f("export"), f("export")])).toEqual([
			"export",
			"export-2",
		]);
	});

	it("treats a leading dot as part of the name, not an extension", () => {
		expect(disambiguateNames([f(".env"), f(".env")])).toEqual([
			".env",
			".env-2",
		]);
	});

	it("is empty for an empty batch", () => {
		expect(disambiguateNames([])).toEqual([]);
	});
});
