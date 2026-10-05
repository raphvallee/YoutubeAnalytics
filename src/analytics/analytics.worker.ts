/// <reference lib="webworker" />
/**
 * Analytics worker - docs/BLUEPRINT.md Phase 9.
 *
 * The dataset lives HERE, not on the main thread. That is the whole point:
 * BLUEPRINT §3.8 assumed "no web worker needed for queries" because a pass over
 * 56k rows was thought to cost single-digit milliseconds, but a full page mount
 * is not one pass - measured at 120k rows the Music page's memo set was ~205ms
 * and the Video page's ~105ms of straight-line main-thread work, all of it
 * inside a React render, so a sidebar click froze the tab instead of navigating.
 * Moving the passes here makes navigation a repaint (a few ms) and lets the page
 * paint a skeleton while this thread crunches.
 *
 * It also means the 120k-row array never has to be structured-cloned across the
 * boundary: IndexedDB is available in workers (the ingestion worker already
 * relies on that), so the rows are read here once and the main thread never
 * receives a copy. Only the small aggregate results travel back.
 *
 * A dataset swap must not be answered with stale rows, so `invalidate` marks the
 * copy stale and every response echoes the generation it was computed against.
 * There is no work queue: each request is a single synchronous pass over an
 * in-memory array, so the only `await` is the reload itself and messages
 * arriving during it are answered against the new copy.
 */

import { loadAllLikes, loadAllStreams, loadSnapshotRecords } from "@/db/db";
import type { LikedTrack, StreamRecord } from "@/db/types";
import { resetTrackKeyMemo } from "@/ingestion/titleParse";
import {
	artistDashboard,
	compareBundle,
	likesDashboard,
	musicDashboard,
	originPlays,
	videoDashboard,
} from "./dashboard";
import type {
	AnalyticsInbound,
	AnalyticsRequest,
	AnalyticsResponseMessage,
} from "./protocol";

let records: StreamRecord[] = [];
let likes: LikedTrack[] = [];
/** Set by `invalidate`; every request reloads before answering while true. */
let stale = true;
/** Snapshot rows, cached one deep - compare only ever uses the active one. */
let snapshot: { id: string; records: StreamRecord[] } | null = null;

function post(message: AnalyticsResponseMessage) {
	self.postMessage(message);
}

/**
 * Re-read everything this worker aggregates over. The track-key memo is
 * dropped with it: it is keyed by title, so entries for titles the new dataset
 * no longer holds are dead weight rather than wrong (see `titleParse.ts`).
 */
async function load(): Promise<void> {
	const [nextRecords, nextLikes] = await Promise.all([
		loadAllStreams(),
		loadAllLikes(),
	]);
	resetTrackKeyMemo();
	records = nextRecords;
	likes = nextLikes;
	// A snapshot the user just deleted would otherwise keep answering.
	snapshot = null;
	stale = false;
}

async function snapshotRecordsOf(
	id: string | null,
): Promise<StreamRecord[] | null> {
	if (id === null) return null;
	if (snapshot?.id === id) return snapshot.records;
	const loaded = await loadSnapshotRecords(id);
	snapshot = { id, records: loaded ?? [] };
	return snapshot.records;
}

/**
 * The dispatch table. Every branch is a `dashboard.ts` call, so the only logic
 * here is the name lookup; the single cast is that table's one seam between the
 * request union and the result map.
 */
function answer(
	request: AnalyticsRequest,
	snap: StreamRecord[] | null,
): unknown {
	switch (request.name) {
		case "musicDashboard":
			return musicDashboard(records, request.range);
		case "artistDashboard":
			return artistDashboard(
				records,
				request.range,
				request.artistKey,
				request.bucket,
			);
		case "videoDashboard":
			return videoDashboard(records, request.range, request.bucket);
		case "likesDashboard":
			return likesDashboard(records, likes);
		case "originPlays":
			return originPlays(records);
		case "compare":
			return compareBundle(
				records,
				snap,
				request.range,
				request.bucket,
				request.artists,
			);
	}
}

self.onmessage = async (event: MessageEvent<AnalyticsInbound>) => {
	const message = event.data;

	if (message.type === "invalidate") {
		stale = true;
		return;
	}

	const { id, generation, request } = message;
	try {
		if (stale) await load();
		const value = answer(
			request,
			await snapshotRecordsOf(
				request.name === "compare" ? request.snapshotId : null,
			),
		);
		post({ type: "result", id, generation, value });
	} catch (err) {
		post({
			type: "error",
			id,
			message: err instanceof Error ? err.message : String(err),
		});
	}
};
