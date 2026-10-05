/**
 * Text-shaped loading placeholders.
 *
 * The loading pattern here is: the page's real structure - toolbar, cards,
 * borders, headings - renders immediately, and only the pieces that are still
 * being computed (stat numbers, table rows, chart bodies) stand in as pulse
 * bars. Sizes are font-relative so a bar occupies the same line box as the
 * text it replaces: nothing moves when the real content lands.
 */

const PULSE = "animate-pulse rounded-[3px] bg-muted/40";

/**
 * Inline stand-in for a run of text. Width is font-relative, height 1em, so it
 * sits on the same baseline and line box as the text it replaces.
 */
export function SkeletonText({
	width = "8ch",
	className = "",
}: {
	width?: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={`inline-block h-[1em] align-baseline ${PULSE} ${className}`}
			style={{ width }}
		/>
	);
}

/** Block bar sized for a table cell or a standalone line. */
export function SkeletonBar({
	width,
	height = "1rem",
	className = "",
}: {
	width: string;
	height?: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={`inline-block ${PULSE} ${className}`}
			style={{ width, height }}
		/>
	);
}

/**
 * Deterministic row widths for skeleton table rows, so the placeholder
 * pattern does not shimmer between renders and keys stay stable.
 */
export const SKELETON_ROW_WIDTHS = [
	"62%",
	"48%",
	"71%",
	"55%",
	"66%",
	"40%",
	"58%",
	"52%",
	"68%",
	"45%",
] as const;

/**
 * Body stand-in for charts: keeps the card at its real fixed height while the
 * numbers behind the chart are computed.
 */
export function SkeletonChartBody() {
	return (
		<div
			aria-hidden="true"
			className="flex h-full flex-col justify-center gap-3"
		>
			{SKELETON_ROW_WIDTHS.slice(0, 6).map((w) => (
				<div key={w} className={`h-2.5 ${PULSE}`} style={{ width: w }} />
			))}
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
