import { describe, expect, it } from "vitest";
import type { ArtistOrigin, StreamRecord } from "@/db/types";
import type { GeoHit } from "@/lib/geocode";
import type { MbArtistHit } from "@/lib/mbArtist";
import {
	isOriginStale,
	ORIGIN_TTL_MONTHS,
	ORIGIN_TTL_MS,
	originFromLookups,
	originTargets,
} from "./origins";

/** Fixed clock for the TTL cases, so they never depend on the real date. */
const NOW = Date.UTC(2026, 9, 4);

function rec(overrides: Partial<StreamRecord>): StreamRecord {
	return {
		id: overrides.id ?? Math.random().toString(36).slice(2),
		ts: 1_700_000_000_000,
		kind: "music",
		videoId: "vid00000001",
		title: "Track",
		rawTitle: "Track",
		artist: "Artist",
		artistKey: "artist",
		artistConfidence: "topic",
		channel: "Artist - Topic",
		channelId: "UC000",
		adDriven: false,
		...overrides,
	};
}

const origin = (artistKey: string): ArtistOrigin => ({
	artistKey,
	artistName: "Artist",
	mbid: "mbid",
	resolvedName: "Artist",
	precision: "city",
	placeName: "X",
	subdivisionName: null,
	countryName: null,
	countryCode: null,
	lat: 0,
	lng: 0,
	resolvedAt: NOW - 1000,
});

describe("originTargets", () => {
	it("aggregates all music plays per artist over all time, plays desc", () => {
		const records = [
			rec({ artistKey: "a", artist: "A", ts: 100 }),
			rec({ artistKey: "a", artist: "A", ts: 200 }),
			rec({ artistKey: "b", artist: "B", ts: 300 }),
			rec({ id: "yt", kind: "youtube", artist: null, artistKey: "" }),
			rec({ id: "unattr", artist: null, artistKey: "" }),
		];
		expect(originTargets(records, [])).toEqual([
			{ artistKey: "a", artist: "A", plays: 2 },
			{ artistKey: "b", artist: "B", plays: 1 },
		]);
	});

	it("drops already-cached artistKeys and keeps the order", () => {
		const records = [
			rec({ artistKey: "a", artist: "A" }),
			rec({ artistKey: "b", artist: "B" }),
		];
		expect(originTargets(records, [origin("a")], NOW)).toEqual([
			{ artistKey: "b", artist: "B", plays: 1 },
		]);
	});

	// The point of the cache: a reload (or a re-import) must not spend
	// requests re-resolving artists whose answers cannot have changed.
	describe("6-month TTL", () => {
		const records = [rec({ artistKey: "a", artist: "A" })];

		it("skips a row resolved just now", () => {
			const fresh = { ...origin("a"), resolvedAt: NOW - 1000 };
			expect(originTargets(records, [fresh], NOW)).toEqual([]);
		});

		it("skips a row resolved a day ago", () => {
			const row = { ...origin("a"), resolvedAt: NOW - 24 * 60 * 60 * 1000 };
			expect(originTargets(records, [row], NOW)).toEqual([]);
		});

		it("keeps a row just inside the window cached", () => {
			const row = {
				...origin("a"),
				resolvedAt: NOW - ORIGIN_TTL_MS + 60_000,
			};
			expect(originTargets(records, [row], NOW)).toEqual([]);
		});

		it("retargets a row past six months", () => {
			const stale = { ...origin("a"), resolvedAt: NOW - ORIGIN_TTL_MS };
			expect(originTargets(records, [stale], NOW)).toEqual([
				{ artistKey: "a", artist: "A", plays: 1 },
			]);
		});

		it("retargets a long-stale row", () => {
			const old = {
				...origin("a"),
				resolvedAt: NOW - 3 * ORIGIN_TTL_MS,
			};
			expect(originTargets(records, [old], NOW)).toHaveLength(1);
		});

		// A clock-skewed or restored-from-backup row would otherwise be
		// refetched on every single load, forever.
		it("treats a future timestamp as fresh, not permanently stale", () => {
			const future = { ...origin("a"), resolvedAt: NOW + 60_000 };
			expect(originTargets(records, [future], NOW)).toEqual([]);
		});

		it("retargets only the stale rows, not the fresh ones", () => {
			const many = [
				rec({ artistKey: "a", artist: "A" }),
				rec({ artistKey: "b", artist: "B" }),
				rec({ artistKey: "c", artist: "C" }),
			];
			const cache = [
				{ ...origin("a"), resolvedAt: NOW - 1000 },
				{ ...origin("b"), resolvedAt: NOW - ORIGIN_TTL_MS - 1 },
				{ ...origin("c"), resolvedAt: NOW - ORIGIN_TTL_MS / 2 },
			];
			expect(originTargets(many, cache, NOW)).toEqual([
				{ artistKey: "b", artist: "B", plays: 1 },
			]);
		});
	});

	// A second import replaces the dataset and bumps lifetime plays. The run
	// loop re-derives its queue from the new records, so artists resolved in
	// the first pass are excluded by cache and the re-ranked remainder is
	// returned plays-desc.
	it("re-ranks by updated lifetime plays and yields only the new artists", () => {
		const firstPass = [
			rec({ artistKey: "a", artist: "A", ts: 100 }),
			rec({ artistKey: "b", artist: "B", ts: 200 }),
		];
		// Second import: "c" is brand new and "b" overtakes "a" on lifetime plays.
		const secondPass = [
			rec({ id: "n1", artistKey: "a", artist: "A", ts: 100 }),
			rec({ id: "n2", artistKey: "b", artist: "B", ts: 200 }),
			rec({ id: "n3", artistKey: "b", artist: "B", ts: 300 }),
			rec({ id: "n4", artistKey: "b", artist: "B", ts: 400 }),
			rec({ id: "n5", artistKey: "c", artist: "C", ts: 500 }),
		];
		// Cache holds what pass 1 already resolved.
		expect(originTargets(secondPass, [origin("a"), origin("b")], NOW)).toEqual([
			{ artistKey: "c", artist: "C", plays: 1 },
		]);
		// With nothing cached, the re-ranked full order is b (3) then a/c (1).
		expect(originTargets(secondPass, [], NOW)).toEqual([
			{ artistKey: "b", artist: "B", plays: 3 },
			{ artistKey: "a", artist: "A", plays: 1 },
			{ artistKey: "c", artist: "C", plays: 1 },
		]);
		expect(originTargets(firstPass, [], NOW)).toHaveLength(2);
	});
});

describe("isOriginStale / ORIGIN_TTL_MS", () => {
	it("is six months", () => {
		expect(ORIGIN_TTL_MONTHS).toBe(6);
		// ~182.6 days: a calendar month averaged over a year, not 30 days.
		expect(ORIGIN_TTL_MS / (24 * 60 * 60 * 1000)).toBeCloseTo(182.625, 2);
	});

	it("is false just inside the window and true at the boundary", () => {
		expect(isOriginStale({ ...origin("a"), resolvedAt: NOW - 1 }, NOW)).toBe(
			false,
		);
		expect(
			isOriginStale({ ...origin("a"), resolvedAt: NOW - ORIGIN_TTL_MS }, NOW),
		).toBe(true);
	});

	it("is false for a future timestamp", () => {
		expect(isOriginStale({ ...origin("a"), resolvedAt: NOW + 1 }, NOW)).toBe(
			false,
		);
	});
});

describe("originFromLookups", () => {
	const mb = (over: Partial<MbArtistHit> = {}): MbArtistHit => ({
		mbid: "mbid-1",
		name: "Resolved",
		type: "Person",
		country: "US",
		beginAreaName: "Baton Rouge",
		areaName: "United States",
		...over,
	});
	const geo = (over: Partial<GeoHit> = {}): GeoHit => ({
		name: "Baton Rouge",
		latitude: 30.45,
		longitude: -91.18,
		country: "United States",
		countryCode: "US",
		admin1: "Louisiana",
		featureCode: "PPLA2",
		...over,
	});
	const centroid = { lat: 39.8, lng: -98.6 };

	it("miss when MusicBrainz has no hit", () => {
		const row = originFromLookups(null, null, null);
		expect(row.precision).toBe("miss");
		expect(row.lat).toBeNull();
		expect(row.mbid).toBeNull();
	});

	it("city: begin area geocoded to a populated place", () => {
		const row = originFromLookups(mb(), geo(), null);
		expect(row.precision).toBe("city");
		expect(row.placeName).toBe("Baton Rouge");
		expect(row.subdivisionName).toBe("Louisiana");
		expect(row.countryCode).toBe("US");
		expect(row.lat).toBeCloseTo(30.45);
	});

	it("subdivision: begin area that is itself a region", () => {
		const row = originFromLookups(
			mb({ beginAreaName: "Île-de-France" }),
			geo({
				name: "Île-de-France",
				featureCode: "ADM1",
				admin1: "Île-de-France",
			}),
			null,
		);
		expect(row.precision).toBe("subdivision");
	});

	it("country fallback when the begin area will not geocode", () => {
		const row = originFromLookups(mb(), null, centroid);
		expect(row.precision).toBe("country");
		expect(row.placeName).toBeNull();
		expect(row.countryName).toBe("United States");
		expect(row.lat).toBeCloseTo(39.8);
	});

	it("country directly when there is no begin area (common for groups)", () => {
		const row = originFromLookups(
			mb({ beginAreaName: null, type: "Group" }),
			null,
			centroid,
		);
		expect(row.precision).toBe("country");
		expect(row.countryCode).toBe("US");
		expect(row.countryName).toBe("United States");
	});

	it("country: geocoded `area` fallback when begin area is absent", () => {
		const row = originFromLookups(
			mb({ beginAreaName: null, areaName: "Sweden" }),
			geo({
				name: "Sweden",
				latitude: 60.13,
				longitude: 18.64,
				country: "Sweden",
				countryCode: "SE",
				admin1: null,
				featureCode: "PCLI",
			}),
			null,
		);
		expect(row.precision).toBe("country");
		expect(row.placeName).toBeNull();
		expect(row.countryCode).toBe("SE");
		expect(row.lat).toBeCloseTo(60.13);
	});

	it("miss when there is neither begin area nor mappable country", () => {
		const row = originFromLookups(
			mb({ country: null, beginAreaName: null }),
			null,
			null,
		);
		expect(row.precision).toBe("miss");
		expect(row.lat).toBeNull();
	});

	it("records the country even when it has no centroid (e.g. Kosovo)", () => {
		const row = originFromLookups(
			mb({ country: "XK", beginAreaName: null }),
			null,
			null,
		);
		expect(row.precision).toBe("miss");
		expect(row.countryName).toBe("Kosovo");
		expect(row.countryCode).toBe("XK");
	});
});
