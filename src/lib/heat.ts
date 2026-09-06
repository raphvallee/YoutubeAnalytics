/**
 * Heat-layer math for the world map (Phase 7). Pure: no React, no DOM -
 * WorldMap interpolates the ramp into SVG fills and scales radii/fades
 * from the sqrt-corrected intensities.
 */

/**
 * Sequential blue ramp, dark surface, bright = more. Same ordinal steps the
 * Phase 6 watch-time calendar validated with the dataviz checker
 * (HeatmapCalendar LEVEL_COLORS = steps 600/500/350/250).
 */
export const HEAT_RAMP = ["#184f95", "#256abf", "#5598e7", "#86b6ef"] as const;

function channel(hex: string, i: number): number {
	return Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
}

/** Ramp interpolated at t (clamped to [0,1]); stop k sits at k/(n-1). */
export function rampColor(t: number): string {
	const first = HEAT_RAMP[0] ?? "#184f95";
	const clamped = Math.min(1, Math.max(0, t));
	const scaled = clamped * (HEAT_RAMP.length - 1);
	const i = Math.min(HEAT_RAMP.length - 2, Math.floor(scaled));
	const lo = HEAT_RAMP[i];
	const hi = HEAT_RAMP[i + 1];
	if (lo === undefined || hi === undefined) return first;
	const f = scaled - i;
	const rgb = [0, 1, 2].map((c) =>
		Math.round(channel(lo, c) + (channel(hi, c) - channel(lo, c)) * f),
	);
	return `#${rgb.map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Weights normalized to [0,1] with a sqrt curve - play counts are
 * heavy-tailed, and radius/fade grow with sqrt so one mega-place does not
 * flatten the rest of the map. Empty input or all-zero weights yield all
 * zeros; negatives clamp to 0.
 */
export function heatIntensities(weights: number[]): number[] {
	let max = 0;
	for (const w of weights) if (w > max) max = w;
	if (max <= 0) return weights.map(() => 0);
	return weights.map((w) => Math.sqrt(Math.max(0, w) / max));
}
