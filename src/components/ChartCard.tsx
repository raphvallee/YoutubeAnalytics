import type { ReactNode } from "react";

/** Shared chart shell: title, subtitle, right-aligned actions, fixed height. */
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
	return (
		<section aria-label={title} className="rounded-lg border p-4">
			<header className="mb-3 flex items-start justify-between gap-4">
				<div>
					<h2 className="font-medium">{title}</h2>
					{subtitle && (
						<p className="text-sm text-muted-foreground">{subtitle}</p>
					)}
				</div>
				{actions && <div className="flex items-center gap-2">{actions}</div>}
			</header>
			<div style={{ height }}>{children}</div>
		</section>
	);
}
