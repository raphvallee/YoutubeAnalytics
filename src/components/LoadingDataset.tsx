/** Full-view loading state shown while the dataset loads from IndexedDB. */
export function LoadingDataset() {
	return (
		<div
			role="status"
			className="flex items-center gap-3 p-6 text-sm text-muted-foreground"
		>
			<span
				aria-hidden="true"
				className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-foreground"
			/>
			Loading dataset…
		</div>
	);
}
