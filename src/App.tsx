import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ImportView from "@/pages/ImportView";
import MapWorldView from "@/pages/MapWorldView";
import MusicView from "@/pages/MusicView";
import VideoView from "@/pages/VideoView";
import { useDatasetStore } from "@/state/dataset";
import { useOriginsStore } from "@/state/origins";

const REPO_URL = "https://github.com/raphvallee/YoutubeAnalytics";

// lucide dropped brand marks, so the official GitHub mark is inlined.
function GitHubMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 16 16"
			fill="currentColor"
			aria-hidden="true"
			className={className}
		>
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a9.42 9.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
		</svg>
	);
}

const NAV_ITEMS = [
	{ to: "/music", label: "Music" },
	{ to: "/video", label: "Videos" },
	{ to: "/map", label: "World Map" },
	{ to: "/import", label: "Import" },
];

export default function App() {
	// Load the dataset once at startup (BLUEPRINT §1.2: everything lives in
	// memory) and kick off artist-origin lookups right away, toggle
	// permitting - the run is store-level so it keeps going in the
	// background no matter which page is open.
	const status = useDatasetStore((s) => s.status);
	const reloadDataset = useDatasetStore((s) => s.reload);
	const recordCount = useDatasetStore((s) => s.records.length);
	const startOrigins = useOriginsStore((s) => s.start);

	useEffect(() => {
		if (status === "idle") reloadDataset();
	}, [status, reloadDataset]);

	useEffect(() => {
		if (status === "ready" && recordCount > 0) startOrigins();
	}, [status, recordCount, startOrigins]);

	return (
		<div className="flex min-h-screen">
			{/* h-screen + sticky keeps the sidebar one viewport tall even when
			    main scrolls long, so mt-auto pins the repo link to the visible
			    bottom instead of the bottom of the whole page. */}
			<nav
				aria-label="Main navigation"
				className="sticky top-0 flex h-screen w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r p-4"
			>
				<span className="mb-4 text-sm font-semibold tracking-tight">
					YT Analytics
				</span>
				{NAV_ITEMS.map((item) => (
					<NavLink
						key={item.to}
						to={item.to}
						className={({ isActive }) =>
							`rounded-md px-3 py-2 text-sm ${isActive ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/50"}`
						}
					>
						{item.label}
					</NavLink>
				))}
				{/* mt-auto pins the repo link to the bottom of the sidebar */}
				<a
					href={REPO_URL}
					target="_blank"
					rel="noreferrer"
					aria-label="View this project on GitHub"
					title="View on GitHub"
					className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
				>
					<GitHubMark className="size-4" />
					GitHub
				</a>
			</nav>
			<main className="flex-1 p-6">
				<ErrorBoundary>
					<Routes>
						<Route path="/" element={<Navigate to="/music" replace />} />
						<Route path="/music" element={<MusicView />} />
						<Route path="/video" element={<VideoView />} />
						<Route path="/map" element={<MapWorldView />} />
						<Route path="/import" element={<ImportView />} />
						<Route path="*" element={<Navigate to="/music" replace />} />
					</Routes>
				</ErrorBoundary>
			</main>
		</div>
	);
}
