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
/** One watch per month for 69 months - a calendar wider than any viewport. */
const WIDE_SPAN = fileURLToPath(
	new URL(
		"../../src/test/fixtures/takeout-fixture-wide-span.json",
		import.meta.url,
	),
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

	// The fixture's "Deleted Video Showcase" row has no subtitles, so it is not
	// a channel. It must not appear as one, and the leaderboard has to say how
	// many views that covers instead of silently disagreeing with the stat tile.
	const channels = page.getByRole("region", { name: "Top channels" });
	await expect(channels.getByText("(unknown channel)")).toHaveCount(0);
	await expect(
		channels.getByText(/1 view in this range not ranked/),
	).toBeVisible();
});

test("the page never scrolls sideways; an oversized chart scrolls itself", async ({
	page,
}) => {
	// Regression: `main` is a flex item, so its default `min-width: auto`
	// resolved to its min-content width - which the calendar heatmap dictated,
	// because `overflow-x: auto` only zeroes the automatic minimum size of
	// flex/grid items, not a block's min-content contribution. The videos page
	// ended up ~5700px wide and scrolled sideways forever. Wide content now
	// scrolls inside its own card.
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, WIDE_SPAN);
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});

	await page.goto("/YoutubeAnalytics/video");
	await expect(page.getByText("Watch-time calendar")).toBeVisible();

	const layout = await page.evaluate(() => {
		const de = document.documentElement;
		const calendar = document.querySelector<HTMLElement>(
			'[role="img"][aria-label^="Watch-time calendar"]',
		);
		if (!calendar) throw new Error("watch-time calendar not rendered");
		// The page must refuse to move sideways at all.
		window.scrollTo(4000, 0);
		const pageScrollX = window.scrollX;
		window.scrollTo(0, 0);
		// The calendar is the component that is genuinely too wide, so it is
		// the one that gets a scrollbar.
		calendar.scrollLeft = 600;
		return {
			viewportWidth: de.clientWidth,
			documentWidth: de.scrollWidth,
			pageScrollX,
			calendarClientWidth: calendar.clientWidth,
			calendarScrollWidth: calendar.scrollWidth,
			calendarScrollLeft: calendar.scrollLeft,
		};
	});

	expect(layout.pageScrollX).toBe(0);
	expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
	expect(layout.calendarScrollWidth).toBeGreaterThan(
		layout.calendarClientWidth,
	);
	expect(layout.calendarScrollLeft).toBeGreaterThan(0);
});

test("the watch-time calendar follows the selected period", async ({
	page,
}) => {
	await page.goto("/YoutubeAnalytics/import");
	// Both fixtures, so the dataset straddles 2025 and 2026 and the per-year
	// totals below have something to reconcile against.
	await importFiles(page, [FIXTURE, SECOND_EXPORT]);
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});

	await page.goto("/YoutubeAnalytics/video");
	const card = page.locator('section[aria-label="Watch-time calendar"]');
	const calendar = card.getByRole("img", { name: /^Watch-time calendar:/ });
	await expect(calendar).toBeVisible();

	// The summary counts only the selected window, so it is the cheapest
	// assertion that the range actually reaches the calendar. The grid (and with
	// it the role=img summary) only exists while there is something to draw.
	const streamsIn = async () => {
		await expect(page.locator('[data-analytics-view="video"]')).toHaveAttribute(
			"aria-busy",
			"false",
		);
		await expect(calendar).toBeVisible();
		const label = await calendar.getAttribute("aria-label");
		return Number(
			label?.match(/calendar: ([\d,]+) streams/)?.[1]?.replace(/,/g, ""),
		);
	};
	const emptyIn = async () => {
		await expect(card.getByText("No streams in range.")).toBeVisible();
		await expect(calendar).toHaveCount(0);
	};
	// One label element per month column (`mb-1` sits on nothing else in here).
	const monthColumns = () => card.locator("div.mb-1");

	const allTime = await streamsIn();
	expect(allTime).toBeGreaterThan(0);
	// The fixture spans two years, so the grid is many columns wide.
	expect(await monthColumns().count()).toBeGreaterThan(1);

	// A window the fixture does not reach leaves nothing to draw.
	await page.getByLabel("Custom range start").fill("1999-01-01");
	await page.getByLabel("Custom range end").fill("1999-01-31");
	await emptyIn();

	// The per-year split has to reconcile with the all-time total.
	const years = await page
		.locator("button")
		.filter({ hasText: /^(19|20)\d\d$/ })
		.allInnerTexts();
	expect(years.length).toBeGreaterThan(1);
	const perYear: number[] = [];
	for (const year of years) {
		await page.getByRole("button", { name: year, exact: true }).click();
		perYear.push(await streamsIn());
	}
	expect(perYear.reduce((a, b) => a + b, 0)).toBe(allTime);

	// A custom window that clips a month mid-way keeps the column but counts
	// only the days inside it.
	await page.getByLabel("Custom range start").fill("2026-09-01");
	await page.getByLabel("Custom range end").fill("2026-09-05");
	await expect(
		card.getByText("Streams per day · 2026-09-01 → 2026-09-05"),
	).toBeVisible();
	await expect(page.locator('[data-analytics-view="video"]')).toHaveAttribute(
		"aria-busy",
		"false",
	);
	expect(await monthColumns().count()).toBe(1);
	const windowed = await streamsIn();
	expect(windowed).toBeGreaterThan(0);
	expect(windowed).toBeLessThan(allTime);
});

/** Navigation must remain usable even before the worker delivers its answer. */
test("navigation remains usable while analytics are pending", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker;
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (!String(url).includes("analytics.worker")) return;
				let handler: ((event: MessageEvent) => void) | null = null;
				Object.defineProperty(this, "onmessage", {
					get: () => handler,
					set: (value: typeof handler) => {
						handler = value;
					},
				});
				// Hold answers until the test explicitly releases them. The real
				// worker still computes, but navigation cannot depend on its reply.
				const held: MessageEvent[] = [];
				let released = false;
				this.addEventListener("message", (event) => {
					if (released) handler?.(event);
					else held.push(event);
				});
				(
					window as unknown as { releaseAnalytics: () => void }
				).releaseAnalytics = () => {
					released = true;
					for (const event of held) handler?.(event);
					held.length = 0;
				};
			}
		};
	});
	await page.goto("/YoutubeAnalytics/import");
	await importFiles(page, FIXTURE);
	await expect(page.getByText("Imported dataset")).toBeVisible({
		timeout: 15_000,
	});

	await page.getByRole("link", { name: "Music", exact: true }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "Crunching" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Videos", exact: true }).click();
	await expect(page).toHaveURL(/\/video$/);
	await expect(
		page.getByRole("status").filter({ hasText: "Crunching" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Import", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Import", exact: true }),
	).toBeVisible();
	await page.evaluate(() => {
		(window as unknown as { releaseAnalytics: () => void }).releaseAnalytics();
	});

	// Every page twice: the first visit computes, the second must be served from
	// the analytics result cache. Levels differ per page (the map leads with an
	// h1), so match on name alone.
	for (const _round of [1, 2]) {
		for (const [link, heading] of [
			["Music", "Favorite artists"],
			["Videos", "Top channels"],
			["World Map", "World map"],
		] as const) {
			await page.getByRole("link", { name: link, exact: true }).click();
			await expect(
				page.getByRole("heading", { name: heading }).first(),
			).toBeVisible({ timeout: 15_000 });
		}
	}
});

/**
 * Write `rows` synthetic rows straight into the app's IndexedDB, then reload.
 *
 * The 9-row fixture answers every aggregation in about a millisecond, so the
 * loading states this suite pins are genuinely never painted - there is nothing
 * to catch, and asserting on them would be a race. A realistic row count makes
 * the wait real and the assertion deterministic, without the ~30s of parsing a
 * 31MB JSON export through the ingestion worker: these tests are about
 * navigation, and ingestion already has its own coverage.
 *
 * Speaks raw IndexedDB rather than importing Dexie into the test: the app has
 * opened (and therefore versioned) the database by the time this runs, and
 * duplicating the schema here would let the two drift apart unnoticed.
 */
async function seedDataset(page: Page, rows: number): Promise<void> {
	// The app must have opened the DB before its stores exist to write into.
	await page.goto("/YoutubeAnalytics/import");
	await expect(page.getByText("Browser storage")).toBeVisible();

	await page.evaluate(async (count) => {
		const START = Date.UTC(2016, 0, 1);
		const SPAN = Date.UTC(2026, 9, 4) - START;
		const open = indexedDB.open("youtube-analytics");
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		const done = (tx: IDBTransaction): Promise<void> =>
			new Promise((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		const write = db.transaction(["streams", "meta"], "readwrite");
		const doneWriting = done(write);
		const streams = write.objectStore("streams");
		let seed = 0x2f6e2b1;
		const rnd = (): number => {
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			return ((seed >>> 0) % 1_000_000) / 1_000_000;
		};
		for (let i = 0; i < count; i++) {
			const music = rnd() < 0.62;
			const artist = `Artist ${Math.floor(rnd() ** 2.4 * 400)}`;
			const track = `Track ${Math.floor(rnd() * 3000)}`;
			streams.put({
				id: `seed-${i}`,
				ts: START + Math.floor(rnd() * SPAN),
				kind: music ? "music" : "youtube",
				videoId: `v${i}`,
				title: music ? `${artist} - ${track}` : `${track} clip`,
				rawTitle: `Vous avez regardé ${track}`,
				artist: music ? artist : null,
				artistKey: music ? artist.toLowerCase() : "",
				artistConfidence: music ? "topic" : "unknown",
				channel: music ? `${artist} - Topic` : `Channel ${i % 800}`,
				channelId: `c${i % 800}`,
				adDriven: false,
			});
		}
		// Meta drives the resolved range, the year buttons and the "has data"
		// check, so the page never has to widen the range itself.
		write.objectStore("meta").put({
			key: "dataset",
			schemaVersion: 1,
			importedAt: Date.now(),
			fileCount: 1,
			rowCount: count,
			musicCount: Math.round(count * 0.62),
			youtubeCount: Math.round(count * 0.38),
			unattributedMusic: 0,
			duplicateCount: 0,
			droppedCount: 0,
			prefixesSeen: ["Vous avez regardé "],
			minTs: START,
			maxTs: START + SPAN,
		});
		await doneWriting;
		db.close();
	}, rows);

	await page.reload();
}

/**
 * Every `role=status` string the page painted while `action` ran.
 *
 * Sampled on animation frames, not with a MutationObserver. An observer's
 * callback is delivered at a microtask checkpoint, and the skeleton commit, the
 * worker's answer and the content commit can all land inside one of those - so
 * an observer reports only the final state and the test silently proves
 * nothing. Frame sampling sees each painted state, which is what "the user saw
 * a loading indicator" actually means.
 */
async function recordStatuses(
	page: Page,
	action: () => Promise<void>,
	settleMs = 2_000,
): Promise<string[]> {
	await page.evaluate(() => {
		const w = window as unknown as {
			__statuses: string[];
			__sampling: boolean;
		};
		w.__statuses = [];
		w.__sampling = true;
		const scan = (): void => {
			for (const el of document.querySelectorAll('[role="status"]')) {
				const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
				if (text && !w.__statuses.includes(text)) w.__statuses.push(text);
			}
		};
		const frame = (): void => {
			scan();
			if (w.__sampling) requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	});
	await action();
	await page.waitForTimeout(settleMs);
	return page.evaluate(() => {
		const w = window as unknown as {
			__statuses: string[];
			__sampling: boolean;
		};
		w.__sampling = false;
		return w.__statuses;
	});
}

/**
 * A page shows a loading state while the worker is busy, then its numbers.
 * Pinned because the loading states are easy to delete as "unnecessary" - the
 * whole point of moving the work off-thread is that the wait is VISIBLE instead
 * of the tab being frozen with no explanation.
 */
test("a page shows its loading state, then its numbers", async ({ page }) => {
	test.setTimeout(180_000);
	await seedDataset(page, 120_000);

	await page.getByRole("link", { name: "Videos", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Top channels" })).toBeVisible(
		{ timeout: 90_000 },
	);

	// Start from a warm page, so the recorded navigation is a genuine cache miss.
	const statuses = await recordStatuses(page, async () => {
		await page.getByRole("link", { name: "Music", exact: true }).click();
		await expect(
			page.getByRole("heading", { name: "Favorite artists" }),
		).toBeVisible({ timeout: 90_000 });
	});
	// The skeleton is announced as a status, not an alert: nothing failed, and a
	// screen reader is told the page is working rather than left in silence.
	expect(statuses.some((s) => /Crunching/.test(s))).toBe(true);
});

/**
 * Changing the time filter must not blank the page: the previous numbers stay
 * on screen while the new range is computed, behind a quiet "updating" marker.
 * Blanking to a spinner on every preset click is what makes a fast app feel slow.
 *
 * Runs against a seeded dataset because the property only exists when the
 * recompute takes real time - and against the 9-row fixture the honest result is
 * the opposite one: the numbers swap within a single frame and nothing is ever
 * blank. Both are correct; only the slow case needs pinning.
 *
 * Asserted over every painted state rather than at two instants, so the
 * guarantee is "never empty at any point", not "was empty when we looked".
 */
test("changing the time filter never blanks the page", async ({ page }) => {
	test.setTimeout(180_000);
	await seedDataset(page, 120_000);

	await page.getByRole("link", { name: "Music", exact: true }).click();
	await expect(
		page.getByRole("region", { name: "Favorite artists" }),
	).toBeVisible({ timeout: 90_000 });
	await page.waitForTimeout(500);

	const observed = await page.evaluate(async () => {
		const squash = (text: string): string => text.replace(/\s+/g, " ").trim();
		const card = document.querySelector(
			'section[aria-label="Favorite artists"]',
		);
		const button = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Last 7 days",
		);
		if (!card || !button) return null;
		const cards: string[] = [];
		const statuses: string[] = [];
		let sampling = true;
		const frame = (): void => {
			cards.push(squash(card.textContent ?? ""));
			for (const el of document.querySelectorAll('[role="status"]')) {
				const text = squash(el.textContent ?? "");
				if (text && !statuses.includes(text)) statuses.push(text);
			}
			if (sampling) requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
		button.click();
		await new Promise((resolve) => setTimeout(resolve, 3_000));
		sampling = false;
		return { cards: [...new Set(cards)], statuses };
	});

	expect(observed).not.toBeNull();
	const cards = observed?.cards ?? [];
	const statuses = observed?.statuses ?? [];
	// Never blank: at no painted moment did the card lose its content.
	expect(cards.every((text) => text.length > 0)).toBe(true);
	// The content really did change, so the assertion is not vacuous.
	expect(cards.length).toBeGreaterThan(1);
	// And the change was announced rather than left silent.
	expect(statuses.some((s) => /Updating/.test(s))).toBe(true);
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
