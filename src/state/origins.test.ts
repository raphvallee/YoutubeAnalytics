import { describe, expect, it } from "vitest";
import type { ArtistOrigin, StreamRecord } from "@/db/types";
import type { GeoHit } from "@/lib/geocode";
import type { MbArtistHit } from "@/lib/mbArtist";
import { originFromLookups, originTargets } from "./origins";

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
	resolvedAt: 1,
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
		expect(originTargets(records, [origin("a")])).toEqual([
			{ artistKey: "b", artist: "B", plays: 1 },
		]);
	});
});

describe("originFromLookups", () => {
	const mb = (over: Partial<MbArtistHit> = {}): MbArtistHit => ({
		mbid: "mbid-1",
		name: "Resolved",
		type: "Person",
		country: "US",
		beginAreaName: "Baton Rouge",
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
