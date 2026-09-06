/** Seconds -> compact duration, e.g. `3h 24m` / `45m` / `12s`. */
export function formatDuration(totalSeconds: number): string {
	if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = Math.floor(totalSeconds % 60);
	if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
	if (m > 0) return `${m}m`;
	return `${s}s`;
}
