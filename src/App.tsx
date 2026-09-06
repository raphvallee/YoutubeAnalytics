import { Navigate, NavLink, Route, Routes } from "react-router";
import ImportView from "@/pages/ImportView";
import MusicView from "@/pages/MusicView";
import OverviewView from "@/pages/OverviewView";

const NAV_ITEMS = [
	{ to: "/music", label: "Music" },
	{ to: "/overview", label: "Overview" },
	{ to: "/import", label: "Import" },
];

export default function App() {
	return (
		<div className="flex min-h-screen">
			<nav className="flex w-48 shrink-0 flex-col gap-1 border-r p-4">
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
				<Routes>
					<Route path="/" element={<Navigate to="/music" replace />} />
					<Route path="/music" element={<MusicView />} />
					<Route path="/overview" element={<OverviewView />} />
					<Route path="/import" element={<ImportView />} />
					<Route path="*" element={<Navigate to="/music" replace />} />
				</Routes>
			</main>
		</div>
	);
}
