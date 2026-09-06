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
