/**
 * Zoom/pan math for the world map (Phase 7). Pure: no React, no DOM. The
 * view is a translate+scale applied to the whole map group; k = 1 fills
 * the viewBox exactly, so the pan bounds below keep the map covering the
 * viewBox at every zoom level (no empty margins when dragged).
 */

export const MAP_W = 960;
export const MAP_H = 500;
export const MAP_MAX_K = 10;

export interface MapView {
	/** Zoom factor (1 = fit the whole map). */
	k: number;
	/** ViewBox-space translate applied before the scale. */
	x: number;
	y: number;
}

export const INITIAL_VIEW: MapView = { k: 1, x: 0, y: 0 };

const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, v));

/** Snap a view to legal bounds: k in [1, MAX_K], map covers the viewBox. */
export function clampView(v: MapView): MapView {
	const k = clamp(v.k, 1, MAP_MAX_K);
	return {
		k,
		x: clamp(v.x, MAP_W - MAP_W * k, 0),
		y: clamp(v.y, MAP_H - MAP_H * k, 0),
	};
}

/**
 * Multiply k by `factor` while keeping the viewBox point (vx, vy) fixed
 * on screen - the standard wheel-zoom-at-cursor behavior.
 */
export function zoomAtPoint(
	v: MapView,
	vx: number,
	vy: number,
	factor: number,
): MapView {
	const k = clamp(v.k * factor, 1, MAP_MAX_K);
	const f = k / v.k;
	return clampView({ k, x: vx - (vx - v.x) * f, y: vy - (vy - v.y) * f });
}
