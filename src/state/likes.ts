import { create } from "zustand";
import { likesCount, loadAllLikes } from "@/db/db";
import type { LikedTrack } from "@/db/types";

interface LikesState {
	count: number;
	likes: LikedTrack[];
	/** Bump to re-read from IndexedDB after upload/clear. */
	reload: () => void;
}

let seq = 0;

/**
 * Likes are an opt-in dataset of their own, so they get their own store and
 * their own request.
 *
 * Note what this does NOT do: it does not invalidate the analytics cache. It is
 * called on every Music-page mount to pick up an upload made on another page,
 * and an unconditional invalidation there would throw away the whole result
 * cache on every navigation - which is precisely what makes navigation instant.
 * The analytics worker keeps its own copy of the likes rows; the thing that
 * knows the rows actually changed is the writer, so `LikesUpload` is where
 * `invalidateAnalytics` belongs.
 */
export const useLikesStore = create<LikesState>((set) => ({
	count: 0,
	likes: [],
	reload: () => {
		const my = ++seq;
		void Promise.all([loadAllLikes(), likesCount()]).then(([likes, count]) => {
			if (my !== seq) return;
			set({ likes, count });
		});
	},
}));
