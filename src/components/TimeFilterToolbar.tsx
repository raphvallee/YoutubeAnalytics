import { type PresetKey, resolveRange, useFilterStore } from "@/state/filters";

const PRESETS: Array<{ key: PresetKey; label: string }> = [
	{ key: "all", label: "All time" },
	{ key: "week", label: "Last 7 days" },
	{ key: "month", label: "Last 30 days" },
	{ key: "year", label: "Last 365 days" },
];

export function TimeFilterToolbar({ years }: { years: number[] }) {
	const preset = useFilterStore((s) => s.preset);
	const selectedYear = useFilterStore((s) => s.selectedYear);
	const custom = useFilterStore((s) => s.custom);
	const setPreset = useFilterStore((s) => s.setPreset);
	const setYear = useFilterStore((s) => s.setYear);
	const setCustom = useFilterStore((s) => s.setCustom);
	const reset = useFilterStore((s) => s.reset);

	const active: PresetKey | number = selectedYear ?? preset;

	const buttonCls = (isActive: boolean) =>
		`rounded-md px-3 py-1.5 text-sm transition-colors ${
			isActive
				? "bg-primary font-medium text-primary-foreground"
				: "text-muted-foreground hover:bg-accent"
		}`;

	return (
		<div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/95 px-1 py-3 backdrop-blur">
			{PRESETS.map((p) => (
				<button
					key={p.key}
					type="button"
					className={buttonCls(active === p.key)}
					onClick={() => setPreset(p.key)}
				>
					{p.label}
				</button>
			))}

			{years.length > 0 && (
				<>
					<span className="mx-1 h-5 w-px bg-border" aria-hidden />
					{years
						.slice()
						.reverse()
						.map((y) => (
							<button
								key={y}
								type="button"
								className={buttonCls(active === y)}
								onClick={() => setYear(y)}
							>
								{y}
							</button>
						))}
				</>
			)}

			<span className="mx-1 h-5 w-px bg-border" aria-hidden />
			<label className="flex items-center gap-1 text-sm text-muted-foreground">
				Custom
				<input
					type="date"
					aria-label="Custom range start"
					value={custom.from}
					onChange={(e) => setCustom({ from: e.target.value })}
					className="rounded-md border bg-transparent px-2 py-1 text-sm"
				/>
				→
				<input
					type="date"
					aria-label="Custom range end"
					value={custom.to}
					onChange={(e) => setCustom({ to: e.target.value })}
					className="rounded-md border bg-transparent px-2 py-1 text-sm"
				/>
			</label>

			<button
				type="button"
				onClick={reset}
				className="ml-auto rounded-md px-2 py-1.5 text-sm text-muted-foreground underline-offset-2 hover:bg-accent hover:underline"
			>
				Reset
			</button>
		</div>
	);
}

/** Resolved label for the current filter, rendered next to section titles. */
export function RangeLabel({
	dataMin,
	dataMax,
}: {
	dataMin: number;
	dataMax: number;
}) {
	const state = useFilterStore();
	const { label } = resolveRange(state, dataMin, dataMax);
	return <span className="text-sm text-muted-foreground">{label}</span>;
}
