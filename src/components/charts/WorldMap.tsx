import { geoEqualEarth, geoPath } from "d3-geo";
import { useMemo, useRef, useState } from "react";
import { worldFeatures } from "@/lib/geo";
import { SERIES_COLORS } from "@/lib/palette";

/**
 * World map of artist origins (Phase 7). Bundled Natural Earth 110m
 * countries rendered as a static equal-earth SVG: countries that contain
 * at least one resolved origin get a subtle tint, one bubble per resolved
 * place sized by all-time plays. All geometry is computed once at module
 * load - nothing is fetched at runtime (base-path rule).
 */

export interface MapPoint {
	key: string;
	lat: number;
	lng: number;
	/** All-time plays of every artist mapped to this place. */
	plays: number;
	artists: Array<{ name: string; plays: number }>;
	place: string;
	precision: "city" | "subdivision" | "country";
}

const WIDTH = 960;
const HEIGHT = 500;

const projection = geoEqualEarth().fitExtent(
	[
		[10, 10],
		[WIDTH - 10, HEIGHT - 10],
	],
	{ type: "Sphere" },
);
const pathGen = geoPath(projection);

const COUNTRY_PATHS = worldFeatures.map((f, i) => ({
	// Natural Earth gives some territories no ISO id (Somaliland, Kosovo,
	// ...) - String(undefined) would collide, so synthesize a stable key.
	id: f.id === undefined || f.id === null ? `x${i}` : String(f.id),
	name: f.properties?.name ?? "",
	d: pathGen(f) ?? "",
}));

const ACCENT = SERIES_COLORS[0] ?? "#3987e5";
const LAND = "#26262b";
const SHADE = `${ACCENT}14`; // same hue, low alpha - subtle "has origins" tint
const STROKE = "#0d0d0d";

const PRECISION_LABEL: Record<MapPoint["precision"], string> = {
	city: "City",
	subdivision: "State / region",
	country: "Country",
};

export function WorldMap({
	points,
	shadedIds,
}: {
	points: MapPoint[];
	shadedIds: Set<string>;
}) {
	const [tip, setTip] = useState<{
		x: number;
		y: number;
		lines: string[];
		title: string;
	} | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);

	const maxPlays = useMemo(
		() => Math.max(1, ...points.map((p) => p.plays)),
		[points],
	);

	const show = (e: React.MouseEvent, title: string, lines: string[]) => {
		const rect = wrapperRef.current?.getBoundingClientRect();
		if (!rect) return;
		setTip({
			x: Math.min(e.clientX - rect.left + 12, rect.width - 140),
			y: Math.max(0, Math.min(e.clientY - rect.top + 12, rect.height - 80)),
			title,
			lines,
		});
	};
	const hide = () => setTip(null);

	return (
		<div className="flex h-full flex-col">
			<div ref={wrapperRef} className="relative flex-1">
				<svg
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					className="h-full w-full"
					role="img"
					aria-label="World map with a point at each artist's place of origin"
				>
					{COUNTRY_PATHS.map((c) => (
						// biome-ignore lint/a11y/noStaticElementInteractions: hover is a decorative layer; the chart exposes role=img
						<path
							key={c.id}
							d={c.d}
							fill={shadedIds.has(c.id) ? SHADE : LAND}
							stroke={STROKE}
							strokeWidth={0.3}
							onMouseMove={(e) =>
								shadedIds.has(c.id)
									? show(e, c.name, ["Contains artist origins"])
									: hide()
							}
							onMouseLeave={hide}
						/>
					))}
					{points.map((p) => {
						const [x, y] = projection([p.lng, p.lat]) ?? [0, 0];
						const r = 3 + 5 * Math.sqrt(p.plays / maxPlays);
						const artists = p.artists.slice(0, 8).map((a) => a.name);
						const hidden = p.artists.length - artists.length;
						return (
							// biome-ignore lint/a11y/noStaticElementInteractions: hover is a decorative layer; the chart exposes role=img
							<circle
								key={p.key}
								cx={x}
								cy={y}
								r={r}
								fill={ACCENT}
								fillOpacity={0.85}
								stroke={STROKE}
								strokeWidth={0.5}
								onMouseMove={(e) =>
									show(e, p.place, [
										`${p.plays.toLocaleString()} all-time plays · ${PRECISION_LABEL[p.precision]}`,
										...artists,
										...(hidden > 0 ? [`+${hidden} more`] : []),
									])
								}
								onMouseLeave={hide}
							/>
						);
					})}
				</svg>
				{tip && (
					<div
						className="pointer-events-none absolute z-10 max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
						style={{ left: tip.x, top: tip.y }}
					>
						<p className="font-medium">{tip.title}</p>
						{tip.lines.map((line) => (
							<p key={line} className="text-muted-foreground">
								{line}
							</p>
						))}
					</div>
				)}
			</div>
			<Legend placed={points.length} />
		</div>
	);
}

function Legend({ placed }: { placed: number }) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
			<span className="flex items-center gap-1.5">
				<svg width="12" height="12" aria-hidden="true">
					<circle cx="6" cy="6" r="5" fill={ACCENT} fillOpacity={0.85} />
				</svg>
				bubble area ∝ all-time plays
			</span>
			<span className="flex items-center gap-1.5">
				<svg width="12" height="12" aria-hidden="true">
					<rect width="12" height="12" rx="2" fill={SHADE} />
				</svg>
				country has origins
			</span>
			<span>
				Origin = birth / foundation place · groups without one fall back to
				country
			</span>
			<span className="ml-auto">
				{placed} place{placed === 1 ? "" : "s"} shown
			</span>
		</div>
	);
}
