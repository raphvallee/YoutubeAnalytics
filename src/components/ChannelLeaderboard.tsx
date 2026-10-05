import { memo } from "react";
import type { ChannelAgg } from "@/analytics/youtube";
import { SKELETON_ROW_WIDTHS, SkeletonBar } from "@/components/SkeletonText";

/** YouTube channel leaderboard with share bars and first-watch dates. */
export const ChannelLeaderboard = memo(function ChannelLeaderboard({
	channels,
	unattributed = 0,
	loading = false,
}: {
	channels: ChannelAgg[];
	/**
	 * Views in range that no real channel can be credited for. Shown as a
	 * footnote so the ranking never silently disagrees with the "Videos
	 * watched" stat tile - see `channelAttribution.ts`.
	 */
	unattributed?: number;
	/** Real header + skeleton rows, so the card keeps its size. */
	loading?: boolean;
}) {
	const max = channels[0]?.plays ?? 0;

	if (loading) {
		return (
			<div className="max-h-full overflow-auto" aria-hidden="true">
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
						{SKELETON_ROW_WIDTHS.map((w) => (
							<tr key={w} className="border-b border-border/50 last:border-0">
								<td className="py-2 pr-2">
									<SkeletonBar width="2ch" height="1rem" />
								</td>
								<td className="py-2 pr-2">
									<SkeletonBar width={w} height="1rem" />
								</td>
								<td className="py-2 pr-2 text-right">
									<SkeletonBar width="6ch" height="1rem" />
								</td>
								<td className="hidden py-2 pr-2 text-right md:table-cell">
									<SkeletonBar width="7ch" height="1rem" />
								</td>
								<td className="hidden p-2 sm:table-cell">
									<div
										className="h-1.5 animate-pulse rounded-full bg-primary/30"
										style={{ width: w }}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	if (channels.length === 0) {
		return (
			<div>
				<p className="py-8 text-center text-sm text-muted-foreground">
					No YouTube views in this range.
				</p>
				<UnattributedNote unattributed={unattributed} />
			</div>
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
			<UnattributedNote unattributed={unattributed} />
		</div>
	);
});

/**
 * Footnote for views left out of the ranking because they name no channel.
 * Sticky to the bottom of the scroll area so it stays readable next to a
 * long table instead of scrolling away under it.
 */
function UnattributedNote({ unattributed }: { unattributed: number }) {
	if (unattributed <= 0) return null;
	return (
		<p className="sticky bottom-0 border-t bg-background px-2 py-2 text-xs text-muted-foreground">
			{unattributed.toLocaleString()} view{unattributed === 1 ? "" : "s"} in
			this range not ranked - Takeout recorded no channel for{" "}
			{unattributed === 1 ? "it" : "them"}.
		</p>
	);
}
