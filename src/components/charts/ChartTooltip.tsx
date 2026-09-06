import { OTHER_COLOR } from "@/lib/palette";

export interface TooltipEntry {
	name: string;
	value: number;
	color: string;
}

/**
 * Shared stacked-chart tooltip: series sorted desc with color chips, muted
 * text tokens (never series-colored text), total row. BLUEPRINT §4.4.
 */
export function ChartTooltip({
	active,
	payload,
	label,
	totalLabel = "Total",
}: {
	active?: boolean;
	payload?: Array<{
		name?: string;
		value?: number | string;
		color?: string;
		dataKey?: string | number;
	}>;
	label?: string | number;
	totalLabel?: string;
}) {
	if (!active || !payload || payload.length === 0) return null;

	const entries: TooltipEntry[] = payload
		.filter((p) => typeof p.value === "number")
		.map((p) => ({
			name: p.name ?? String(p.dataKey ?? ""),
			value: p.value as number,
			color: p.color ?? OTHER_COLOR,
		}))
		.sort((a, b) => b.value - a.value);

	const total = entries.reduce((sum, e) => sum + e.value, 0);
	if (total === 0) return null;

	return (
		<div className="rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md">
			<p className="mb-1 text-xs text-muted-foreground">{label}</p>
			<table className="text-sm">
				<tbody>
					{entries.map((e) => (
						<tr key={e.name}>
							<td className="pr-2">
								<span
									className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle"
									style={{ background: e.color }}
								/>
								<span className="text-muted-foreground">{e.name}</span>
							</td>
							<td className="text-right font-mono tabular-nums">
								{e.value.toLocaleString()}
							</td>
						</tr>
					))}
					{entries.length > 1 && (
						<tr className="border-t">
							<td className="pr-2 pt-1 text-muted-foreground">{totalLabel}</td>
							<td className="pt-1 text-right font-mono font-medium tabular-nums">
								{total.toLocaleString()}
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}
