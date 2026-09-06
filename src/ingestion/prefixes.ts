/**
 * Takeout emits locale-dependent title prefixes: "Watched X" (en),
 * "Vous avez regardé X" (fr), "Angesehen: X" (de), ...
 * The real export in this repo is French. docs/BLUEPRINT.md §2.4.
 */

export const WATCH_PREFIXES = [
	"Vous avez regardé ", // fr
	"Watched ", // en
	"Angesehen: ", // de
	"Viste ", // es
	"Visualização de ", // pt-BR
	"Hai guardato ", // it
	"Pregledali ste ", // hr
	"Wyświetlono ", // pl
	"Você assistiu ", // pt-PT
	"て観覧しまし", // ja (" を視聴しました" family, matched loosely below)
] as const;

export const SEARCH_PREFIXES = [
	"Vous avez recherché ", // fr
	"Searched ", // en
	"Sie haben gesucht: ", // de
	"Buscaste ", // es
	"Pesquisou ", // pt-BR
	"Hai cercato ", // it
	"検索しまし", // ja
] as const;

export type TitleStrip =
	| { type: "stream"; title: string; prefix: string }
	| { type: "search"; prefix: string }
	| { type: "unknown"; title: string };

/** Longest-prefix match, checked before the loose fallbacks. */
export function stripTitlePrefix(rawTitle: string): TitleStrip {
	// Takeout uses non-breaking spaces in some locales; normalize for matching
	// only — returned titles are sliced from the raw string (1:1 length holds).
	const norm = rawTitle.replace(/\s/g, " ");
	for (const p of WATCH_PREFIXES) {
		if (norm.startsWith(p)) {
			return { type: "stream", title: rawTitle.slice(p.length), prefix: p };
		}
	}
	for (const p of SEARCH_PREFIXES) {
		if (norm.startsWith(p)) {
			return { type: "search", prefix: p };
		}
	}
	// Loose fallbacks for locale families not in the table (ja/ko/zh embed the
	// marker mid-sentence). A title that still contains a watch marker keeps
	// everything after it; a search marker means the row is not a stream.
	const jaWatch = norm.indexOf("を視聴しました");
	if (jaWatch !== -1 && norm.length > jaWatch + "を視聴しました".length) {
		const title = rawTitle.slice(jaWatch + "を視聴しました".length).trim();
		return {
			type: "stream",
			title,
			prefix: rawTitle.slice(0, jaWatch + "を視聴しました".length),
		};
	}
	return { type: "unknown", title: rawTitle };
}

export function isSearchTitle(rawTitle: string): boolean {
	return (
		stripTitlePrefix(rawTitle).type === "search" ||
		SEARCH_PREFIXES.some((p) => rawTitle.includes(p))
	);
}
