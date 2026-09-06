import { toPng } from "html-to-image";
import { type ReactNode, useCallback, useRef } from "react";

/**
 * Shared chart shell: title, subtitle, right-aligned actions, fixed height.
 * Carries the Phase 6 download-as-PNG button (BLUEPRINT §4.3).
 */
export function ChartCard({
	title,
	subtitle,
	actions,
	height = 340,
	children,
}: {
	title: string;
	subtitle?: ReactNode;
	actions?: ReactNode;
	height?: number;
	children: ReactNode;
}) {
	const bodyRef = useRef<HTMLDivElement>(null);

	const downloadPng = useCallback(async () => {
		const node = bodyRef.current;
		if (!node) return;
		const dataUrl = await toPng(node, {
			backgroundColor: "#0d0d0d",
			pixelRatio: 2,
		});
		const link = document.createElement("a");
		link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
		link.href = dataUrl;
		link.click();
	}, [title]);

	return (
		<section aria-label={title} className="rounded-lg border p-4">
			<header className="mb-3 flex items-start justify-between gap-4">
				<div>
					<h2 className="font-medium">{title}</h2>
					{subtitle && (
						<p className="text-sm text-muted-foreground">{subtitle}</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					{actions}
					<button
						type="button"
						aria-label={`Download ${title} as PNG`}
						title="Download as PNG"
						className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => void downloadPng()}
					>
						PNG
					</button>
				</div>
			</header>
			<div ref={bodyRef} style={{ height }}>
				{children}
			</div>
		</section>
	);
}
