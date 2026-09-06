/**
 * World geometry (Phase 7). Decodes the bundled Natural Earth 110m TopoJSON
 * once at module load and derives country centroids for country-level
 * origins - all local, no network.
 */
import { geoCentroid } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import topologyJson from "world-atlas/countries-110m.json";
import { ISO_COUNTRIES } from "./iso";

const topology = topologyJson as unknown as Topology;
const collection = feature(
	topology,
	topology.objects.countries as GeometryCollection,
);

export type WorldFeature = Feature<Geometry, { name?: string }>;

/** Country features, Antarctica dropped (no listening audience there). */
export const worldFeatures: WorldFeature[] = collection.features.filter(
	(f) => String(f.id) !== "010",
);

/** alpha-2 → [lng, lat] centroid, computed once from the country polygon. */
const CENTROIDS = new Map<string, [number, number]>();
for (const [alpha2, info] of Object.entries(ISO_COUNTRIES)) {
	if (info.numeric === "") continue;
	const f = worldFeatures.find((w) => String(w.id) === info.numeric);
	if (f) CENTROIDS.set(alpha2, geoCentroid(f));
}

/** Centroid [lat, lng] of a country (ISO 3166-1 alpha-2), null if unknown. */
export function countryCentroid(
	alpha2: string | null | undefined,
): { lat: number; lng: number } | null {
	if (!alpha2) return null;
	const c = CENTROIDS.get(alpha2.toUpperCase());
	if (!c) return null;
	const [lng, lat] = c;
	return { lat, lng };
}
