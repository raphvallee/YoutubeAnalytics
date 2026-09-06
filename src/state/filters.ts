import { endOfYear, startOfYear, subDays } from "date-fns";
import { create } from "zustand";
import type { Range } from "@/analytics/queries";

export type PresetKey = "all" | "week" | "month" | "year" | "custom";

export type CustomDates = { from: string; to: string }; // yyyy-MM-dd strings

interface FilterState {
	preset: PresetKey;
	/** Selected year when preset === a year value; stored separately since years are dynamic. */
	selectedYear: number | null;
	custom: CustomDates;
	setPreset: (p: PresetKey) => void;
	setYear: (y: number) => void;
	setCustom: (c: Partial<CustomDates>) => void;
	reset: () => void;
}

export const useFilterStore = create<FilterState>((set) => ({
	preset: "all",
	selectedYear: null,
	custom: { from: "", to: "" },
	setPreset: (preset) => set({ preset, selectedYear: null }),
	setYear: (selectedYear) => set({ selectedYear }),
	setCustom: (c) =>
		set((s) => ({
			custom: { ...s.custom, ...c },
			preset: "custom",
			selectedYear: null,
		})),
	reset: () =>
		set({ preset: "all", selectedYear: null, custom: { from: "", to: "" } }),
}));

/** Active preset selector: preset==='all' with selectedYear set means a year slice. */
export function activePreset(s: FilterState): PresetKey | number {
	if (s.selectedYear !== null) return s.selectedYear;
	return s.preset;
}

function parseDay(day: string, endOfDay = false): number | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
	const ts = new Date(`${day}T00:00:00`).getTime();
	if (Number.isNaN(ts)) return null;
	return endOfDay ? ts + 86_399_999 : ts;
}

/**
 * Resolve the active filter to a concrete range + human label.
 * Relative presets are trailing windows ending now (BLUEPRINT §3.6).
 */
export function resolveRange(
	s: FilterState,
	dataMinTs: number,
	dataMaxTs: number,
): { range: Range; label: string } {
	const now = Date.now();
	const year = s.selectedYear;
	switch (s.selectedYear !== null ? "yearSel" : s.preset) {
		case "week":
			return {
				range: { from: subDays(now, 7).getTime(), to: now },
				label: "Last 7 days",
			};
		case "month":
			return {
				range: { from: subDays(now, 30).getTime(), to: now },
				label: "Last 30 days",
			};
		case "year":
			return {
				range: { from: subDays(now, 365).getTime(), to: now },
				label: "Last 365 days",
			};
		case "yearSel": {
			if (year === null) break;
			return {
				range: {
					from: startOfYear(new Date(year, 0, 1)).getTime(),
					to: endOfYear(new Date(year, 0, 1)).getTime(),
				},
				label: String(year),
			};
		}
		case "custom": {
			const from = parseDay(s.custom.from);
			const to = parseDay(s.custom.to, true);
			if (from === null || to === null) break;
			return {
				range: { from, to },
				label: `${s.custom.from} → ${s.custom.to}`,
			};
		}
		default:
			break;
	}
	return { range: { from: dataMinTs, to: dataMaxTs }, label: "All time" };
}
