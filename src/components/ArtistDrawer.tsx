import { useEffect } from "react";

/**
 * Right-side slide-over for the artist profile. Hand-rolled (portal-free,
 * fixed overlay) to keep component ownership local.
 */
export function ArtistDrawer({
	open,
	onClose,
	title,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
}) {
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			className="fixed inset-0 z-50"
			role="dialog"
			aria-modal="true"
			aria-label={title}
		>
			<button
				type="button"
				aria-label="Close artist panel"
				className="absolute inset-0 bg-black/60"
				onClick={onClose}
			/>
			<aside className="absolute top-0 right-0 flex h-full w-full max-w-xl flex-col overflow-y-auto border-l bg-background p-6 shadow-xl">
				<header className="mb-4 flex items-center justify-between">
					<h2 className="text-xl font-semibold">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent"
					>
						Close
					</button>
				</header>
				{children}
			</aside>
		</div>
	);
}
