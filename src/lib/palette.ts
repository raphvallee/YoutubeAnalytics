/**
 * Categorical series palette - dataviz skill reference instance, dark-mode
 * steps (app is dark-first). Adjacency-validated: worst CVD ΔE 8.4, normal
 * 19.3, all ≥3:1 on the dark surface. Fixed slot order, never cycled;
 * the 9th+ series folds into "Other" (gray) upstream.
 */

export const SERIES_COLORS: string[] = [
	"#3987e5", // 1 blue
	"#d95926", // 2 orange
	"#199e70", // 3 aqua
	"#c98500", // 4 yellow
	"#d55181", // 5 magenta
	"#008300", // 6 green
	"#9085e9", // 7 violet
	"#e66767", // 8 red
];

export const OTHER_COLOR = "#898781"; // muted ink - never a categorical slot

/**
 * Stable color assignment: colors follow the entity (artist/track), not its
 * rank. First registry wins persistently across filter changes.
 */
const registry = new Map<string, number>();

export function seriesColor(entityKey: string): string {
	let slot = registry.get(entityKey);
	if (slot === undefined) {
		slot = registry.size % SERIES_COLORS.length;
		registry.set(entityKey, slot);
	}
	return SERIES_COLORS[slot] ?? OTHER_COLOR;
}

/** Reset the registry (used when the dataset changes). */
export function resetSeriesColors(): void {
	registry.clear();
}
