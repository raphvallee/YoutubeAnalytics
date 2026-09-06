import { Component, type ErrorInfo, type ReactNode } from "react";

/** Route-level error boundary: a bad chart/render must not blank the app. */
export class ErrorBoundary extends Component<
	{ children: ReactNode },
	{ error: Error | null }
> {
	override state: { error: Error | null } = { error: null };

	static getDerivedStateFromError(error: Error): { error: Error } {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("Unhandled render error:", error, info.componentStack);
	}

	override render(): ReactNode {
		if (this.state.error) {
			return (
				<div
					role="alert"
					className="m-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4"
				>
					<h2 className="font-medium">
						Something broke while rendering this page.
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{this.state.error.message}
					</p>
					<button
						type="button"
						className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
						onClick={() => this.setState({ error: null })}
					>
						Try again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
