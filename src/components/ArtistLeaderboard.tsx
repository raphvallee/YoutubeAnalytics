import { type ArtistAgg, estSeconds } from "@/analytics/queries";
import { formatDuration } from "@/lib/format";

/**
 * Ranked favorite artists. Row click opens the artist profile drawer.
 * Text stays in ink tokens; a muted share bar carries magnitude.
 */
export function ArtistLeaderboard({
	artists,
	onSelect,
	likesByArtist,
}: {
	artists: ArtistAgg[];
	onSelect: (artistKey: string, artist: string) => void;
	/** Optional like counts per artistKey; column renders "—" when absent. */
	likesByArtist?: Map<string, number>;
}) {
	const max = artists[0]?.plays ?? 0;

	if (artists.length === 0) {
		return (
			<p className="py-8 text-center text-sm text-muted-foreground">
				No attributed music streams in this range.
			</p>
		);
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th scope="col" className="py-2 pr-2 font-medium">
							#
						</th>
						<th scope="col" className="py-2 pr-2 font-medium">
							Artist
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Plays
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Est. time
						</th>
						<th scope="col" className="py-2 pr-2 text-right font-medium">
							Likes
						</th>
						<th
							scope="col"
							className="hidden py-2 pl-2 font-medium sm:table-cell"
						>
							Share
						</th>
					</tr>
				</thead>
				<tbody>
					{artists.map((a, i) => (
						<tr
							key={a.artistKey}
							className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
							tabIndex={0}
							aria-label={`Open ${a.artist} profile, ${a.plays} plays`}
							onClick={() => onSelect(a.artistKey, a.artist)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelect(a.artistKey, a.artist);
								}
							}}
						>
							<td className="py-2 pr-2 font-mono text-xs text-muted-foreground">
								{i + 1}
							</td>
							<td className="py-2 pr-2 font-medium">{a.artist}</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums">
								{a.plays.toLocaleString()}
							</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
								{formatDuration(estSeconds(a.plays))}
							</td>
							<td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
								{likesByArtist?.get(a.artistKey)?.toLocaleString() ?? "—"}
							</td>
							<td className="hidden py-2 pl-2 sm:table-cell">
								<div
									className="h-1.5 rounded-full bg-primary/60"
									style={{
										width: `${max > 0 ? Math.max((a.plays / max) * 100, 2) : 0}%`,
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
