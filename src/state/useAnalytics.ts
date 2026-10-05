/**
 * `useAnalytics` - the one hook every page uses to get its numbers
 * (docs/BLUEPRINT.md Phase 9).
 *
 * It exists to make "instant, with loading" the default rather than something
 * each page has to remember:
 *
 * - **First render of a page shows a skeleton.** Nothing has arrived yet, so
 *   the caller renders its loading state and the browser paints right away -
 *   the worker does the waiting, not the thread that has to draw.
 * - **Later inputs keep the old numbers on screen.** Changing the time filter
 *   flips `refreshing` and leaves `data` alone. Blanking a dashboard to a
 *   spinner on every year click feels slower than the 200ms it replaces;
 *   showing the previous answer for 200ms with a quiet "updating" marker does
 *   not. A dataset change IS different - those numbers described rows that no
 *   longer exist - so it drops stale data and goes back to a skeleton.
 * - **Unmounts do not leak.** A late answer for a request the page has moved
 *   past is ignored rather than set.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	analyticsGeneration,
	runAnalytics,
	subscribeAnalyticsGeneration,
} from "@/analytics/analyticsClient";
import type {
	AnalyticsRequest,
	RequestFor,
	ResultFor,
} from "@/analytics/protocol";

export interface AnalyticsQuery<K extends AnalyticsRequest["name"]> {
	/** The last answer for this input, or null before the first one lands. */
	data: ResultFor<K> | null;
	/** True while there is nothing to show yet - render a skeleton. */
	pending: boolean;
	/** True while previous data stays on screen behind a newer request. */
	refreshing: boolean;
	error: string | null;
}

export function useAnalytics<K extends AnalyticsRequest["name"]>(
	request: RequestFor<K> | null,
): AnalyticsQuery<K> {
	// Subscribing to the generation is what makes a dataset swap re-ask: the
	// generation is part of the cache key, but a hook that never re-read it
	// would keep handing back the answer it already holds.
	const generation = useSyncExternalStore(
		subscribeAnalyticsGeneration,
		analyticsGeneration,
		analyticsGeneration,
	);
	const [state, setState] = useState<{
		generation: number;
		key: string | null;
		data: ResultFor<K> | null;
		error: string | null;
	}>({ generation, key: null, data: null, error: null });
	/** Monotonic request token: only the newest answer may land. */
	const newest = useRef(0);

	useEffect(() => {
		if (request === null) return;
		// No "have I already asked this" bookkeeping here on purpose. An effect
		// guard that remembers the last request has a fatal interaction with
		// StrictMode: mount asks, the simulated unmount sets `active = false`,
		// and the re-mount then declines to re-ask - so the only answer this hook
		// ever gets arrives after it stopped listening, and the page hangs on its
		// skeleton forever. Duplicate asks are free instead: `runAnalytics`
		// de-duplicates in-flight requests by request key and answers repeats
		// from its result cache, so re-running this effect costs a Map lookup.
		const key = JSON.stringify(request);
		const token = ++newest.current;
		let active = true;
		void runAnalytics(request).then(
			(data) => {
				if (!active || token !== newest.current) return;
				setState({ generation, key, data, error: null });
			},
			(err: unknown) => {
				if (!active || token !== newest.current) return;
				setState((prev) => ({
					// Keyed by generation as well, so a dataset swap cannot leave
					// an answer computed from the previous rows on screen.
					generation,
					key,
					// Keep whatever is showing: a failed refresh should not wipe
					// the page the user was reading.
					data: prev.generation === generation ? prev.data : null,
					error: err instanceof Error ? err.message : String(err),
				}));
			},
		);
		return () => {
			active = false;
		};
	}, [request, generation]);

	if (request === null) {
		return { data: null, pending: false, refreshing: false, error: null };
	}
	const key = JSON.stringify(request);
	const current = state.generation === generation;
	const settled = current && state.key === key;
	const held = current ? state.data : null;
	return {
		data: held,
		pending: !settled && held === null,
		refreshing: !settled && held !== null,
		error: current ? state.error : null,
	};
}
