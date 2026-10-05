/**
 * Skeleton placeholder for a page whose numbers are still in the worker
 * (docs/BLUEPRINT.md Phase 9).
 *
 * Deliberately shaped like the page it replaces - toolbar, stat row, two tall
 * cards - so the layout does not jump when the real content lands. It is a
 * status, not an alert: nothing failed.
 */

function Bar({ className }: { className: string }) {
	return (
		<div
			aria-hidden="true"
			className={`animate-pulse rounded bg-muted/40 ${className}`}
		/>
	);
}

/** Fixed count, so the keys are stable rather than derived from an index. */
const STAT_TILES = ["plays", "artists", "tracks", "time"] as const;

export function PageSkeleton({
	label = "Crunching your history",
}: {
	label?: string;
}) {
	return (
		<div className="space-y-6" role="status" aria-live="polite">
			<span className="sr-only">{label}…</span>
			<Bar className="h-9 w-64" />
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{STAT_TILES.map((slot) => (
					<Bar key={slot} className="h-[68px] w-full" />
				))}
			</div>
			<Bar className="h-[380px] w-full" />
			<Bar className="h-[380px] w-full" />
		</div>
	);
}

/**
 * Quiet "these numbers are being recomputed" marker. Sits next to content that
 * is deliberately still on screen, so it must not take layout space or animate
 * aggressively - the point is that the page did not blank.
 */
export function RefreshingBadge() {
	return (
		<span
			role="status"
			aria-live="polite"
			className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
		>
			<span
				aria-hidden="true"
				className="h-2.5 w-2.5 animate-spin rounded-full border border-border border-t-foreground"
			/>
			Updating…
		</span>
	);
}
