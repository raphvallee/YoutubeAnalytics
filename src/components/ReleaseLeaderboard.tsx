import type { ReleaseAgg } from "@/analytics/releases";

/**
 * Enriched releases (Phase 6): MusicBrainz-resolved "Release - Topic"
 * channelIds ranked by plays. Read-time join - streams are never mutated.
 */
export function ReleaseLeaderboard({ releases }: { releases: ReleaseAgg[] }) {
	if (releases.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No enriched releases yet. Upload a Takeout export, then opt in and run
				MusicBrainz enrichment on the Import page.
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
							Release
						</th>
						<th scope="col" className="py-2 pr-2 font-medium">
							Artist
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Year
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Plays
						</th>
					</tr>
				</thead>
				<tbody>
					{releases.map((r, i) => (
						<tr
							key={r.channelId}
							className="border-b border-border/50 last:border-0"
						>
							<td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
								{i + 1}
							</td>
							<td className="py-2 pr-2 font-medium">{r.releaseName}</td>
							<td className="py-2 pr-2 text-muted-foreground">
								{r.artistName ?? "-"}
							</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
								{r.date ? r.date.slice(0, 4) : "-"}
							</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums">
								{r.plays.toLocaleString()}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
