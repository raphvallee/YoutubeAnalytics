import type { ArtistDelta } from "@/analytics/compare";
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
	deltas,
}: {
	artists: ArtistAgg[];
	onSelect: (artistKey: string, artist: string) => void;
	/** Optional like counts per artistKey; column renders "-" when absent. */
	likesByArtist?: Map<string, number>;
	/** Optional snapshot deltas (Phase 6 compare); column hidden when absent. */
	deltas?: Map<string, ArtistDelta>;
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
		<div className="max-h-full overflow-auto">
			<table className="w-full text-sm">
				<thead className="sticky top-0 z-10 bg-background">
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
						{deltas && (
							<th scope="col" className="py-2 pr-2 text-right font-medium">
								vs snap
							</th>
						)}
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
					{artists.map((a, i) => {
						const delta = deltas?.get(a.artistKey);
						return (
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
								{deltas && <DeltaCell delta={delta} />}
								<td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
									{formatDuration(estSeconds(a.plays))}
								</td>
								<td className="py-2 pr-2 text-right font-mono tabular-nums text-muted-foreground">
									{likesByArtist?.get(a.artistKey)?.toLocaleString() ?? "-"}
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
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

/** Snapshot delta: arrow glyph carries the direction, color is a cue. */
function DeltaCell({ delta }: { delta: ArtistDelta | undefined }) {
	if (!delta) {
		return <td className="py-2 pr-2 text-right text-muted-foreground">-</td>;
	}
	if (delta.pct === null) {
		return (
			<td className="py-2 pr-2 text-right text-xs text-muted-foreground">
				new
			</td>
		);
	}
	const pct = Math.round(delta.pct * 100);
	const up = pct >= 0;
	return (
		<td
			className={`py-2 pr-2 text-right font-mono text-xs tabular-nums ${up ? "text-[#0ca30c]" : "text-[#e66767]"}`}
		>
			{up ? "▲" : "▼"} {Math.abs(pct)}%
		</td>
	);
}
