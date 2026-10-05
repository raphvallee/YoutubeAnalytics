/**
 * Wire format between the page components and the analytics worker
 * (docs/BLUEPRINT.md Phase 9).
 *
 * Everything here must survive `structuredClone` - the worker boundary is a
 * structured clone, not a live object graph. Plain arrays, objects and `Map`s
 * qualify; functions, class instances and DOM nodes do not. That is why a
 * request carries data (a range, an artistKey, a leaderboard to join against)
 * rather than a callback, and why the results are the render-ready aggregates
 * themselves instead of "run this query" instructions.
 */

import type { Bucket } from "@/analytics/buckets";
import type {
	ArtistDashboard,
	CompareBundle,
	MusicDashboard,
	VideoDashboard,
} from "@/analytics/dashboard";
import type { LikesMatch } from "@/analytics/likes";
import type { ArtistAgg, Range } from "@/analytics/queries";

/** The six things a page can ask for. One request per page, not per chart. */
export type AnalyticsRequest =
	| { name: "musicDashboard"; range: Range }
	| { name: "artistDashboard"; range: Range; artistKey: string; bucket: Bucket }
	| { name: "videoDashboard"; range: Range; bucket: Bucket }
	| { name: "likesDashboard" }
	| { name: "originPlays" }
	| {
			name: "compare";
			range: Range;
			bucket: Bucket;
			/** Current leaderboard rows the deltas are joined against. */
			artists: ArtistAgg[];
			snapshotId: string | null;
	  };

export type RequestFor<K extends AnalyticsRequest["name"]> = Extract<
	AnalyticsRequest,
	{ name: K }
>;

/** What each request answers with. */
export interface AnalyticsResults {
	musicDashboard: MusicDashboard;
	artistDashboard: ArtistDashboard;
	videoDashboard: VideoDashboard;
	likesDashboard: LikesMatch;
	originPlays: Map<string, { artist: string; plays: number }>;
	compare: CompareBundle;
}

export type ResultFor<K extends AnalyticsRequest["name"]> = AnalyticsResults[K];

export type AnalyticsRequestMessage = {
	type: "query";
	id: number;
	/**
	 * Dataset generation this request was minted against. The worker echoes it
	 * back so the client can drop a result computed from rows the UI has
	 * already replaced (an import landing mid-flight).
	 */
	generation: number;
	request: AnalyticsRequest;
};

/** "Something the analytics layer reads out of IndexedDB changed - re-read." */
export type AnalyticsInvalidateMessage = {
	type: "invalidate";
	generation: number;
};

export type AnalyticsInbound =
	| AnalyticsRequestMessage
	| AnalyticsInvalidateMessage;

/** Worker -> main thread. */
export type AnalyticsResponseMessage =
	| { type: "result"; id: number; generation: number; value: unknown }
	| { type: "error"; id: number; message: string };
