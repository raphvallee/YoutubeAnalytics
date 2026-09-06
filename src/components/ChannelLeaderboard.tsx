import type { ChannelAgg } from "@/analytics/youtube";

/** YouTube channel leaderboard with share bars and first-watch dates. */
export function ChannelLeaderboard({ channels }: { channels: ChannelAgg[] }) {
	const max = channels[0]?.plays ?? 0;

	if (channels.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No YouTube views in this range.
			</p>
		);
	}

	return (
		<div className="max-h-full overflow-auto">
			<table className="w-full text-sm">
				<thead className="sticky top-0 z-10 bg-background">
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th scope="col" className="py-2 pr-2 font-medium">
							#
						</th>
						<th scope="col" className="py-2 pr-2 font-medium">
							Channel
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Views
						</th>
						<th
							scope="col"
							className="hidden py-2 pr-2 text-right font-medium md:table-cell"
						>
							First watch
						</th>
						<th scope="col" className="hidden p-2 font-medium sm:table-cell">
							Share
						</th>
					</tr>
				</thead>
				<tbody>
					{channels.map((c, i) => (
						<tr
							key={c.channelId ?? c.channel}
							className="border-b border-border/50 last:border-0"
						>
							<td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
								{i + 1}
							</td>
							<td className="py-2 pr-2 font-medium">{c.channel}</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums">
								{c.plays.toLocaleString()}
							</td>
							<td className="hidden py-2 pr-2 text-right font-mono text-xs tabular-nums text-muted-foreground md:table-cell">
								{c.firstWatch
									? new Date(c.firstWatch).toLocaleDateString()
									: "-"}
							</td>
							<td className="hidden p-2 sm:table-cell">
								<div
									className="h-1.5 rounded-full bg-primary/60"
									style={{
										width: `${max > 0 ? Math.max((c.plays / max) * 100, 2) : 0}%`,
									}}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
