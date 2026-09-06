import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clearLikes, replaceLikes } from "@/db/db";
import { parseLikesFile } from "@/ingestion/likesParse";
import { useLikesStore } from "@/state/likes";

/**
 * Optional "Liked music / Liked videos" playlist upload (BLUEPRINT §2.6).
 * Runs on the main thread - playlist exports are tiny next to histories.
 */
export function LikesUpload() {
	const count = useLikesStore((s) => s.count);
	const reload = useLikesStore((s) => s.reload);
	const inputRef = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);

	const onPick = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const files = Array.from(e.target.files ?? []);
			e.target.value = "";
			if (files.length === 0) return;
			setError(null);
			try {
				const all = [];
				for (const file of files) {
					const text = await file.text();
					const parsed = parseLikesFile(text, file.name);
					if (parsed.length === 0) {
						throw new Error(
							`${file.name}: no recognizable playlist rows (expected a Takeout playlist CSV or a JSON array).`,
						);
					}
					all.push(...parsed);
				}
				await replaceLikes(all);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			} finally {
				reload();
			}
		},
		[reload],
	);

	const onClear = useCallback(async () => {
		await clearLikes();
		reload();
	}, [reload]);

	return (
		<div className="rounded-lg border p-4">
			<div className="mb-2 flex items-center justify-between">
				<h2 className="font-medium">Liked playlist (optional)</h2>
				<Button variant="ghost" size="sm" onClick={() => void onClear()}>
					Clear likes
				</Button>
			</div>
			<p className="mb-3 text-sm text-muted-foreground">
				To add explicit likes to artist rankings, export your "Liked music" or
				"Liked videos" playlist from Takeout (<code>playlists/….csv</code>) and
				upload it here.
			</p>
			<input
				ref={inputRef}
				type="file"
				accept=".csv,.json"
				multiple
				className="hidden"
				onChange={(e) => void onPick(e)}
			/>
			<Button
				variant="outline"
				size="sm"
				onClick={() => inputRef.current?.click()}
			>
				Upload playlist export
			</Button>
			<p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
				{count > 0
					? `${count.toLocaleString()} liked tracks stored.`
					: "No likes uploaded yet."}
			</p>
			{error && (
				<div
					role="alert"
					className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
				>
					{error}
				</div>
			)}
		</div>
	);
}
