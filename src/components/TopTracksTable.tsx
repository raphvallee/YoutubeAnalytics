import { estSeconds, type TrackAgg } from "@/analytics/queries";
import { formatDuration } from "@/lib/format";

export function TopTracksTable({
	tracks,
	showArtist = true,
}: {
	tracks: TrackAgg[];
	showArtist?: boolean;
}) {
	if (tracks.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No music streams in this range.
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
							Track
						</th>
						{showArtist && (
							<th scope="col" className="py-2 pr-2 font-medium">
								Artist
							</th>
						)}
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Plays
						</th>
						<th scope="col" className="py-2 text-right font-medium">
							Est. time
						</th>
					</tr>
				</thead>
				<tbody>
					{tracks.map((t, i) => (
						<tr
							key={`${t.artistKey}|${t.trackKey}`}
							className="border-b border-border/50 last:border-0"
						>
							<td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
								{i + 1}
							</td>
							<td className="py-2 pr-2 font-medium">{t.title}</td>
							{showArtist && (
								<td className="py-2 pr-2 text-muted-foreground">
									{t.artist ?? "-"}
								</td>
							)}
							<td className="py-2 pr-2 text-right font-mono tabular-nums">
								{t.plays.toLocaleString()}
							</td>
							<td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
								{formatDuration(estSeconds(t.plays))}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
