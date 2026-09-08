import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const FIXTURE = fileURLToPath(
	new URL("../../src/test/fixtures/takeout-fixture.json", import.meta.url),
);

/**
 * Blueprint Phase 5 checkpoint smoke:
 * import fixture → navigate all pages → assert non-empty content.
 * Each test gets a fresh browser context = fresh IndexedDB.
 */
test("import fixture, then music + video pages render data", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	await page.setInputFiles('input[type="file"]', FIXTURE);

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

test("empty state shows the import pointer", async ({ page }) => {
	await page.goto("/YoutubeAnalytics/music");
	await expect(page.getByText(/No data imported yet/)).toBeVisible();
});

test("world map renders with origins lookups disabled", async ({ page }) => {
	// Keep the smoke hermetic: never hit MusicBrainz/Open-Meteo from CI.
	await page.addInitScript(() => {
		localStorage.setItem("origin-lookup-optin", "0");
	});
	await page.goto("/YoutubeAnalytics/import");
	await page.setInputFiles('input[type="file"]', FIXTURE);
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
