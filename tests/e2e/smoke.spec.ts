import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const FIXTURE = fileURLToPath(
	new URL("../../src/test/fixtures/takeout-fixture.json", import.meta.url),
);
const SECOND_EXPORT = fileURLToPath(
	new URL(
		"../../src/test/fixtures/takeout-fixture-second-export.json",
		import.meta.url,
	),
);
const SEARCH_HISTORY = fileURLToPath(
	new URL(
		"../../src/test/fixtures/search-history-fixture.json",
		import.meta.url,
	),
);
const LIKED_CSV = fileURLToPath(
	new URL("../../src/test/fixtures/liked-music-fixture.csv", import.meta.url),
);

/** Pick files, wait for the preflight table, confirm the import. */
async function importFiles(page: Page, files: string | string[]) {
	await page.setInputFiles('input[type="file"]', files);
	await expect(page.getByText("Ready to import")).toBeVisible({
		timeout: 15_000,
	});
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByText("Ready to import")).toBeHidden();
}

/** Stage files without importing, and return the staged row names. */
async function stageFiles(page: Page, files: string | string[]) {
	await page.setInputFiles('input[type="file"]', files);
	await expect(page.getByText("Ready to import")).toBeVisible({
		timeout: 15_000,
	});
}

/** The disambiguated name of each staged row, in list order. */
async function stagedLabels(page: Page): Promise<string[]> {
	return page
		.locator("section ul li")
		.allInnerTexts()
		.then((rows) =>
			rows
				.filter((r) => /History|Playlist|Skipped|Checking/.test(r))
				.map((r) => r.split("\n")[1] ?? ""),
		);
}

/**
 * Three folders, each holding a different file called `watch-history.json` -
 * exactly what a user accumulates when they download Takeout more than once.
 * Returns the paths.
 */
function sameNamedExports(): string[] {
	const base = join(tmpdir(), "yt-analytics-same-name");
	rmSync(base, { force: true, recursive: true });
	for (const dir of ["a", "b", "c"])
		mkdirSync(join(base, dir), { recursive: true });
	const sources = [
		"takeout-fixture.json",
		"takeout-fixture-second-export.json",
		"search-history-fixture.json",
	];
	return sources.map((name, i) => {
		const dest = join(base, ["a", "b", "c"][i] ?? "a", "watch-history.json");
		copyFileSync(
			fileURLToPath(
				new URL(`../../src/test/fixtures/${name}`, import.meta.url),
			),
			dest,
		);
		return dest;
	});
}

/**
 * Blueprint Phase 5 checkpoint smoke:
 * import fixture → navigate all pages → assert non-empty content.
 * Each test gets a fresh browser context = fresh IndexedDB.
 */
test("import fixture, then music + video pages render data", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, FIXTURE);

	const metaPanel = page.getByText("Imported dataset");
	await expect(metaPanel).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText("Total streams")).toBeVisible();

	// Music: leaderboard has at least one artist row (fixture has 4 attributed artists)
	await page.goto("/YoutubeAnalytics/music");
	await expect(
		page.getByRole("heading", { name: "Favorite artists" }),
	).toBeVisible();
	const artistsRegion = page.getByRole("region", { name: "Favorite artists" });
	await expect(
		artistsRegion.getByRole("cell", { name: "Future", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Taste over time")).toBeVisible();

	// Video: channel leaderboard non-empty (fixture has 4 youtube rows)
	await page.goto("/YoutubeAnalytics/video");
	await expect(
		page.getByRole("heading", { name: "Top channels" }),
	).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "Data Engineering Channel", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Peak viewing hours")).toBeVisible();
});

test("a playlist export in the same drop is routed to likes", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, [FIXTURE, LIKED_CSV]);

	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText("Liked tracks added")).toBeVisible();
	// Likes are their own dataset, so they show in their own card.
	await expect(page.getByText("2 liked tracks stored.")).toBeVisible();
});

test("empty state shows the import pointer", async ({ page }) => {
	await page.goto("/YoutubeAnalytics/music");
	await expect(page.getByText(/No data imported yet/)).toBeVisible();
});

test("the repo link stays in view on a page taller than the viewport", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, FIXTURE);
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});

	await page.goto("/YoutubeAnalytics/music");
	await expect(
		page.getByRole("heading", { name: "Favorite artists" }),
	).toBeVisible();

	// Regression: the sidebar is mt-auto-pinned to the bottom, so it used to
	// be pushed off-screen once main grew past the viewport.
	const repoLink = page.getByRole("link", {
		name: "View this project on GitHub",
	});
	await expect(repoLink).toBeInViewport();
});

test("world map renders with origins lookups disabled", async ({ page }) => {
	// Keep the smoke hermetic: never hit MusicBrainz/Open-Meteo from CI.
	await page.addInitScript(() => {
		localStorage.setItem("origin-lookup-optin", "0");
	});
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, FIXTURE);
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});

	await page.goto("/YoutubeAnalytics/map");
	await expect(page.getByRole("heading", { name: "World map" })).toBeVisible();
	await expect(
		page.getByRole("img", { name: /World map with a point/ }),
	).toBeVisible();
	// No cache yet and lookups off: origins table shows its empty state.
	await expect(page.getByText(/No origins resolved yet/)).toBeVisible();
});

test("separate drops accumulate into one batch", async ({ page }) => {
	await page.goto("/YoutubeAnalytics/import");

	// One export per drop, which is what the user actually has to do: each
	// Takeout part is named watch-history.json, so the files live apart.
	await stageFiles(page, FIXTURE);
	await expect(page.getByText("1 history file")).toBeVisible();

	await stageFiles(page, SECOND_EXPORT);
	await expect(page.getByText("2 history files")).toBeVisible();

	// The same file again is refused rather than silently duplicated.
	await stageFiles(page, SECOND_EXPORT);
	await expect(page.getByText("already in this batch")).toBeVisible();
	await expect(page.getByText("2 history files")).toBeVisible();

	// One import covers the whole batch.
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});
	await expect(totalStreams(page)).toHaveText("11");
});

test("same-named exports are numbered by their position in the batch", async ({
	page,
}) => {
	const [first, second, third] = sameNamedExports() as [string, string, string];
	await page.goto("/YoutubeAnalytics/import");

	// Three different files, all called watch-history.json, one per drop.
	await stageFiles(page, first);
	await stageFiles(page, second);
	await stageFiles(page, third);

	await expect(stagedLabels(page)).resolves.toEqual([
		"watch-history.json",
		"watch-history-2.json",
		"watch-history-3.json",
	]);
	// The renamed rows still say what they are on disk.
	await expect(
		page.getByText("on disk as watch-history.json").first(),
	).toBeVisible();
	// The counter follows the batch, so removing the first renumbers the rest.
	await page
		.getByRole("button", { name: /^Remove watch-history\.json from/ })
		.first()
		.click();
	await expect(stagedLabels(page)).resolves.toEqual([
		"watch-history.json",
		"watch-history-2.json",
	]);
});

test("identical bytes are collapsed instead of numbered", async ({ page }) => {
	await page.goto("/YoutubeAnalytics/import");
	// Same fixture twice: different folders so the browser hands us two File
	// objects, identical bytes.
	const copy = join(tmpdir(), "yt-analytics-dup-watch-history.json");
	copyFileSync(FIXTURE, copy);

	await page.setInputFiles('input[type="file"]', [FIXTURE, copy]);
	await expect(page.getByText("Ready to import")).toBeVisible();
	const notice = page.getByText(/identical file already in this batch/);
	await expect(notice).toBeVisible();
	// The notice belongs to the batch list, not the page-level error banner:
	// it renders inside the "Ready to import" panel and is a status, not an
	// alert, so a screen reader does not announce it as a failure.
	const panel = page
		.locator("div.rounded-lg")
		.filter({ has: page.getByText("Ready to import") })
		.last();
	await expect(panel.locator('p[role="status"]')).toContainText(
		"Ignored 1 identical file",
	);
	await expect(page.getByRole("alert")).toHaveCount(0);
	// One row survives, keeping its real name (no "-2" for a duplicate).
	await expect(stagedLabels(page)).resolves.toEqual(["takeout-fixture.json"]);

	// Removing the survivor clears the note, which no longer describes the batch.
	await page.getByRole("button", { name: /^Remove takeout-fixture/ }).click();
	await expect(page.getByText("Ready to import")).toBeHidden();
	await expect(notice).toBeHidden();
});

test("a staged file can be pulled back out of the batch", async ({ page }) => {
	await page.goto("/YoutubeAnalytics/import");

	await stageFiles(page, FIXTURE);
	await stageFiles(page, SEARCH_HISTORY);
	await expect(page.getByText("1 history file, 1 skipped")).toBeVisible();

	await page.getByRole("button", { name: /Remove takeout-fixture/ }).click();
	await expect(page.getByText("1 history file")).toBeHidden();
	// Only the skipped file is left, so nothing is importable.
	await expect(
		page.getByRole("button", { name: "Import", exact: true }),
	).toBeDisabled();

	// Removed files can be staged again.
	await stageFiles(page, FIXTURE);
	await expect(page.getByText("1 history file, 1 skipped")).toBeVisible();
});

test("a Takeout folder can be dropped whole: history imports, search history skips", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	// Both files are named the same in real exports, and the file picker
	// cannot multi-select across folders - so this is the actual situation.
	await page.setInputFiles('input[type="file"]', [FIXTURE, SEARCH_HISTORY]);

	// Preflight names the good file, flags the bad one with a reason, and
	// nothing has been written yet.
	await expect(page.getByText("Ready to import")).toBeVisible();
	await expect(page.getByText("search-history-fixture.json")).toBeVisible();
	await expect(page.getByText(/Looks like search-history\.json/)).toBeVisible();
	await expect(page.getByText("Imported dataset")).toBeHidden();

	await page.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText("Added to dataset")).toBeVisible();
	// Provenance counts what was read, not what was dropped on the zone.
	await expect(
		page.getByText("Files imported").locator("xpath=following-sibling::dd[1]"),
	).toHaveText("1");
});

/** The number shown next to "Total streams" in the imported-dataset panel. */
function totalStreams(page: Page) {
	return page
		.getByText("Total streams")
		.locator("xpath=following-sibling::dd[1]");
}

test("add mode keeps the earlier export; replace mode discards it", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, FIXTURE);
	// 12 fixture rows: 1 search row and 1 broken-time row dropped, 1 duplicate.
	await expect(totalStreams(page)).toHaveText("9");

	// Second export, add mode (the default and the remembered choice).
	await page.setInputFiles('input[type="file"]', SECOND_EXPORT);
	await expect(page.getByText("Ready to import")).toBeVisible();
	await expect(
		page.getByRole("button", { name: /Add to imported data/ }),
	).toHaveAttribute("aria-pressed", "true");
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByText("Added to dataset")).toBeVisible({
		timeout: 15_000,
	});
	await expect(totalStreams(page)).toHaveText("11");

	// Replace is offered explicitly, snapshots first, and warns.
	page.once("dialog", (d) => {
		expect(d.message()).toContain("Replace the current dataset");
		void d.accept();
	});
	await page.setInputFiles('input[type="file"]', SECOND_EXPORT);
	await page.getByRole("button", { name: /Replace everything/ }).click();
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await expect(page.getByText("Dataset replaced")).toBeVisible({
		timeout: 15_000,
	});
	await expect(totalStreams(page)).toHaveText("2");
	// The pre-import snapshot is there to restore from.
	await expect(page.getByText(/Before replace -/)).toBeVisible();
});
