/**
 * Main-thread client for the analytics worker (docs/BLUEPRINT.md Phase 9).
 *
 * Three jobs, all of them about keeping navigation instant:
 *
 * 1. **One long-lived worker.** Spawned on the first query and kept after it,
 *    so the dataset is read from IndexedDB once per change rather than once per
 *    page visit, and a second visit costs a message instead of a database read.
 * 2. **A result cache keyed by request + generation.** Navigating Music ->
 *    Video -> Music answers the second Music visit from memory: no request, no
 *    skeleton, no waiting. Bounded, because clicking through the year buttons
 *    would otherwise pin one result per range ever visited.
 * 3. **Two counters the UI can render**: the dataset generation (so components
 *    re-ask when the rows change) and the number of in-flight requests (so the
 *    app can show progress instead of looking frozen).
 *
 * The worker is treated as fallible: if it dies, every in-flight request
 * rejects and the next call transparently spawns a fresh one, so nothing here
 * can strand the UI in a loading state.
 */

import type {
	AnalyticsInbound,
	AnalyticsRequest,
	AnalyticsResponseMessage,
	RequestFor,
	ResultFor,
} from "./protocol";

/** Results kept in memory. Small: one entry per range the user visited. */
const CACHE_LIMIT = 24;

interface Waiter {
	key: string;
	// The response arrives as `unknown` (it crossed a worker boundary) and is
	// resolved against the request's declared result type by the caller that
	// asked, which is the only place that pairing is knowable.
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
/**
 * Bumped whenever the tables the worker aggregates over change (dataset reload,
 * likes upload). It is part of every cache key and is echoed on every response,
 * so a result computed from rows the UI has already replaced can never be
 * adopted.
 */
let generation = 0;

const cache = new Map<string, unknown>();
const waiters = new Map<number, Waiter>();
/**
 * Requests already sent and not yet answered, keyed the same way as the cache.
 *
 * This is what lets the hook depend on the request OBJECT without a
 * "have I already asked this" guard of its own: two identical asks in the same
 * tick (React StrictMode's mount-and-remount is the reliable one) share one
 * message and one promise instead of racing two copies of the same answer.
 */
const inflight = new Map<string, Promise<unknown>>();
const generationListeners = new Set<() => void>();

/** Notifies components that ask again when the underlying rows change. */
export function subscribeAnalyticsGeneration(listener: () => void): () => void {
	generationListeners.add(listener);
	return () => {
		generationListeners.delete(listener);
	};
}

export function analyticsGeneration(): number {
	return generation;
}

/** Insert with bounded, insertion-ordered eviction. */
function remember(key: string, value: unknown): void {
	cache.set(key, value);
	while (cache.size > CACHE_LIMIT) {
		const oldest = cache.keys().next();
		if (oldest.done) break;
		cache.delete(oldest.value);
	}
}

/** Drop the worker, reject everything waiting on it, forget every result. */
function kill(reason: Error): void {
	worker?.terminate();
	worker = null;
	for (const waiter of waiters.values()) waiter.reject(reason);
	waiters.clear();
	inflight.clear();
	cache.clear();
}

function ensureWorker(): Worker {
	if (worker) return worker;
	const created = new Worker(
		new URL("./analytics.worker.ts", import.meta.url),
		{
			type: "module",
		},
	);
	created.onmessage = (event: MessageEvent<AnalyticsResponseMessage>) => {
		const message = event.data;
		const waiter = waiters.get(message.id);
		if (!waiter) return;
		waiters.delete(message.id);
		inflight.delete(waiter.key);
		if (message.type === "error") {
			waiter.reject(new Error(message.message));
			return;
		}
		// An answer for a generation the UI has moved past is dropped, not
		// cached: whatever asked for it has already been superseded. The promise
		// still resolves, so a caller waiting on it is not left hanging.
		if (message.generation !== generation) {
			waiter.resolve(message.value);
			return;
		}
		remember(waiter.key, message.value);
		waiter.resolve(message.value);
	};
	created.onerror = (event) => {
		kill(new Error(event.message || "Analytics worker crashed"));
	};
	worker = created;
	return created;
}

/**
 * Tell the worker that the tables it reads have changed. Called by the stores
 * that own those writes (dataset reload, likes upload, snapshot delete), so the
 * next request re-reads them.
 */
export function invalidateAnalytics(): void {
	generation += 1;
	cache.clear();
	inflight.clear();
	for (const listener of generationListeners) listener();
	worker?.postMessage({
		type: "invalidate",
		generation,
	} satisfies AnalyticsInbound);
}

/**
 * Ask the worker one question. Resolves with a clone of the aggregate; rejects
 * only when the worker itself failed, never because a newer request replaced
 * this one (that is the caller's business, not an error).
 */
export function runAnalytics<K extends AnalyticsRequest["name"]>(
	request: RequestFor<K>,
): Promise<ResultFor<K>> {
	const key = `${generation}:${request.name}:${JSON.stringify(request)}`;
	const hit = cache.get(key);
	if (hit !== undefined) return Promise.resolve(hit as ResultFor<K>);
	const alreadyAsked = inflight.get(key);
	if (alreadyAsked) return alreadyAsked as Promise<ResultFor<K>>;

	const id = nextId++;
	const target = ensureWorker();
	const promise = new Promise<ResultFor<K>>((resolve, reject) => {
		waiters.set(id, {
			key,
			resolve: resolve as (value: unknown) => void,
			reject,
		});
	});
	inflight.set(key, promise);
	target.postMessage({
		type: "query",
		id,
		generation,
		request,
	} satisfies AnalyticsInbound);
	return promise;
}
