import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ImportView from "@/pages/ImportView";
import MapWorldView from "@/pages/MapWorldView";
import MusicView from "@/pages/MusicView";
import VideoView from "@/pages/VideoView";
import { useDatasetStore } from "@/state/dataset";
import { useOriginsStore } from "@/state/origins";

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
			<nav
				aria-label="Main navigation"
				className="flex w-48 shrink-0 flex-col gap-1 border-r p-4"
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
