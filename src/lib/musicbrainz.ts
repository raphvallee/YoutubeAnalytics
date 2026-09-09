/**
 * Shared MusicBrainz helpers used by artist-origin lookup (Phase 7).
 * Release-Topic enrichment functions live in src/state/enrichment.ts.
 */

export const MB_MIN_INTERVAL_MS = 1000;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(new DOMException("Aborted", "AbortError"));
			},
			{ once: true },
		);
	});
}
