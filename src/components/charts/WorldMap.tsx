import { geoEqualEarth, geoPath } from "d3-geo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { worldFeatures } from "@/lib/geo";
import { HEAT_RAMP, heatIntensities, rampColor } from "@/lib/heat";
import {
	clampView,
	INITIAL_VIEW,
	MAP_H,
	MAP_W,
	type MapView,
	zoomAtPoint,
} from "@/lib/mapZoom";
import { SERIES_COLORS } from "@/lib/palette";

/**
 * World map of artist origins (Phase 7). Bundled Natural Earth 110m
 * countries rendered as a static equal-earth SVG: countries that contain
 * at least one resolved origin get a subtle tint, one marker per resolved
 * place. Two view modes, switched by the parent: "dots" (bubble area ∝
 * all-time plays) and "heat" / "heat-plays" (blurred sequential-ramp glow
 * per place, weighted by artist count or by all-time plays). Zoomable:
 * wheel/double-click to zoom, drag to pan, +/−/reset buttons. All geometry
 * is computed once at module load - nothing is fetched at runtime
 * (base-path rule).
 */

export type MapMode = "dots" | "heat" | "heat-plays";

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

// Heat layer: blurred glow per place, colored from the sequential ramp.
// Radius/fade follow the sqrt-corrected intensity (see src/lib/heat.ts).
const HEAT_BLUR = 10;
const HEAT_MIN_R = 9;
const HEAT_SPAN_R = 24;
const HEAT_MIN_OPACITY = 0.2;
const HEAT_OPACITY_SPAN = 0.65;

const ZOOM_STEP = 1.6;
const DBLCLICK_STEP = 1.8;

const PRECISION_LABEL: Record<MapPoint["precision"], string> = {
	city: "City",
	subdivision: "State / region",
	country: "Country",
};

const MODE_ARIA: Record<MapMode, string> = {
	dots: "World map with a point at each artist's place of origin",
	heat: "World map heat layer of artist origins, one glow per place",
	"heat-plays":
		"World map heat layer of artist origins weighted by all-time plays",
};

export function WorldMap({
	points,
	shadedIds,
	mode,
}: {
	points: MapPoint[];
	shadedIds: Set<string>;
	mode: MapMode;
}) {
	const [tip, setTip] = useState<{
		x: number;
		y: number;
		lines: string[];
		title: string;
	} | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const svgRef = useRef<SVGSVGElement | null>(null);
	const [view, setView] = useState<MapView>(INITIAL_VIEW);
	const dragRef = useRef<{
		px: number;
		py: number;
		x: number;
		y: number;
	} | null>(null);

	// Unweighted heat = artist count per place; "heat-plays" = all-time plays.
	const intensities = useMemo(
		() =>
			heatIntensities(
				points.map((p) => (mode === "heat-plays" ? p.plays : p.artists.length)),
			),
		[points, mode],
	);

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

	/** Client coordinates -> viewBox coordinates (undoes the meet fit). */
	const toView = useCallback((clientX: number, clientY: number) => {
		const svg = svgRef.current;
		if (!svg) return null;
		const rect = svg.getBoundingClientRect();
		const scale = Math.min(rect.width / MAP_W, rect.height / MAP_H);
		const ox = (rect.width - MAP_W * scale) / 2;
		const oy = (rect.height - MAP_H * scale) / 2;
		return {
			vx: (clientX - rect.left - ox) / scale,
			vy: (clientY - rect.top - oy) / scale,
			scale,
		};
	}, []);

	// Wheel zoom needs a non-passive listener; React's onWheel is passive.
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const p = toView(e.clientX, e.clientY);
			if (!p) return;
			// Exponential steps work for both pixel and line delta modes.
			const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.0015)));
			setView((v) => zoomAtPoint(v, p.vx, p.vy, factor));
		};
		svg.addEventListener("wheel", onWheel, { passive: false });
		return () => svg.removeEventListener("wheel", onWheel);
	}, [toView]);

	const zoomCenter = (factor: number) =>
		setView((v) => zoomAtPoint(v, MAP_W / 2, MAP_H / 2, factor));

	return (
		<div className="flex h-full flex-col">
			{/* min-h-0: without it the svg's intrinsic viewBox height keeps the
				flex item from shrinking and the map bleeds into the next card. */}
			<div ref={wrapperRef} className="relative min-h-0 flex-1">
				<svg
					ref={svgRef}
					viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
					className="h-full w-full cursor-grab active:cursor-grabbing select-none [touch-action:none]"
					role="img"
					aria-label={MODE_ARIA[mode]}
					onPointerDown={(e) => {
						if (e.button !== 0) return;
						dragRef.current = {
							px: e.clientX,
							py: e.clientY,
							x: view.x,
							y: view.y,
						};
						e.currentTarget.setPointerCapture(e.pointerId);
					}}
					onPointerMove={(e) => {
						const d = dragRef.current;
						if (!d) return;
						const p = toView(e.clientX, e.clientY);
						if (!p) return;
						setView(
							clampView({
								k: view.k,
								x: d.x + (e.clientX - d.px) / p.scale,
								y: d.y + (e.clientY - d.py) / p.scale,
							}),
						);
					}}
					onPointerUp={() => {
						dragRef.current = null;
					}}
					onPointerCancel={() => {
						dragRef.current = null;
					}}
					onDoubleClick={(e) => {
						const p = toView(e.clientX, e.clientY);
						if (p) setView((v) => zoomAtPoint(v, p.vx, p.vy, DBLCLICK_STEP));
					}}
				>
					<defs>
						<filter
							id="wm-heat-blur"
							x="-20%"
							y="-20%"
							width="140%"
							height="140%"
						>
							<feGaussianBlur stdDeviation={HEAT_BLUR} />
						</filter>
						<clipPath id="wm-land-clip">
							{COUNTRY_PATHS.map((c) => (
								<path key={c.id} d={c.d} />
							))}
						</clipPath>
					</defs>
					<g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
						{COUNTRY_PATHS.map((c) => (
							// biome-ignore lint/a11y/noStaticElementInteractions: hover is a decorative layer; the chart exposes role=img
							<path
								key={c.id}
								d={c.d}
								fill={mode === "dots" && shadedIds.has(c.id) ? SHADE : LAND}
								stroke={STROKE}
								strokeWidth={0.3 / view.k}
								onMouseMove={(e) =>
									mode === "dots" && shadedIds.has(c.id)
										? show(e, c.name, ["Contains artist origins"])
										: hide()
								}
								onMouseLeave={hide}
							/>
						))}
						{mode !== "dots" && (
							// Clip the glow to the land silhouette so it never
							// bleeds over the ocean or outside the map.
							<g clipPath="url(#wm-land-clip)">
								<g filter="url(#wm-heat-blur)">
									{points.map((p, i) => {
										const [x, y] = projection([p.lng, p.lat]) ?? [0, 0];
										const t = intensities[i] ?? 0;
										return (
											<circle
												key={p.key}
												cx={x}
												cy={y}
												r={HEAT_MIN_R + HEAT_SPAN_R * t}
												fill={rampColor(t)}
												fillOpacity={HEAT_MIN_OPACITY + HEAT_OPACITY_SPAN * t}
											/>
										);
									})}
								</g>
							</g>
						)}
						{mode === "dots" &&
							points.map((p) => {
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
										strokeWidth={0.5 / view.k}
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
						{mode !== "dots" &&
							points.map((p, i) => {
								const [x, y] = projection([p.lng, p.lat]) ?? [0, 0];
								const t = intensities[i] ?? 0;
								const artists = p.artists.slice(0, 8).map((a) => a.name);
								const hidden = p.artists.length - artists.length;
								return (
									// biome-ignore lint/a11y/noStaticElementInteractions: transparent hover hit area over the heat glow; the chart exposes role=img
									<circle
										key={`hit-${p.key}`}
										cx={x}
										cy={y}
										r={Math.max(10, HEAT_MIN_R + HEAT_SPAN_R * t)}
										fill="transparent"
										onMouseMove={(e) =>
											show(e, p.place, [
												`${p.plays.toLocaleString()} all-time plays · ${p.artists.length} artist${p.artists.length === 1 ? "" : "s"}`,
												...artists,
												...(hidden > 0 ? [`+${hidden} more`] : []),
											])
										}
										onMouseLeave={hide}
									/>
								);
							})}
					</g>
				</svg>
				<div className="absolute right-2 top-2 z-10 flex flex-col gap-1">
					<button
						type="button"
						aria-label="Zoom in"
						title="Zoom in"
						className="rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => zoomCenter(ZOOM_STEP)}
					>
						+
					</button>
					<button
						type="button"
						aria-label="Zoom out"
						title="Zoom out"
						className="rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => zoomCenter(1 / ZOOM_STEP)}
						disabled={view.k <= 1}
					>
						−
					</button>
					<button
						type="button"
						aria-label="Reset zoom and pan"
						title="Reset view"
						className="rounded-md border bg-background/80 px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => setView(INITIAL_VIEW)}
						disabled={view.k <= 1 && view.x === 0 && view.y === 0}
					>
						⌂
					</button>
				</div>
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
			<Legend placed={points.length} mode={mode} />
		</div>
	);
}

function Legend({ placed, mode }: { placed: number; mode: MapMode }) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
			{mode === "dots" ? (
				<>
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
				</>
			) : (
				<>
					<span className="flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="h-2.5 w-16 rounded-sm"
							style={{
								background: `linear-gradient(to right, ${HEAT_RAMP.join(", ")})`,
							}}
						/>
						{mode === "heat-plays"
							? "few → many all-time plays"
							: "few → many artists"}
					</span>
					<span>glow clipped to land</span>
				</>
			)}
			<span>
				Origin = birth / foundation place · groups without one fall back to
				country
			</span>
			<span>scroll to zoom · drag to pan · double-click to zoom in</span>
			<span className="ml-auto">
				{placed} place{placed === 1 ? "" : "s"} shown
			</span>
		</div>
	);
}
