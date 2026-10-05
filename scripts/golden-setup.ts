/**
 * Extract the current HEAD revision of every analytics module into
 * `src/.golden-baseline/` so `scripts/golden-check.ts` and
 * `scripts/bench-ab.ts` can import the pre-change implementation beside the
 * current one and compare or time them over identical records.
 *
 * The baseline lives under `src/` on purpose: its own relative imports stay
 * correct and the `@/*` alias still resolves, so no extra build config is
 * needed. It is gitignored - never commit it, and never ship it.
 *
 *   bun run golden:setup
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODULES = [
	"queries",
	"likes",
	"buckets",
	"youtube",
	"heatmap",
	"releases",
	"compare",
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src", ".golden-baseline");
mkdirSync(out, { recursive: true });

let ref = "HEAD";
const arg = process.argv[2];
if (arg) {
	// Compare against an explicit revision, e.g. a commit or a branch name.
	ref = arg;
}

for (const mod of MODULES) {
	const path = `src/analytics/${mod}.ts`;
	const source = execFileSync("git", ["show", `${ref}:${path}`], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});
	writeFileSync(join(out, `${mod}.ts`), source, "utf8");
	console.log(`extracted ${path} @ ${ref}`);
}

console.log(`\nbaseline written to ${out} (${MODULES.length} modules)`);
console.log("next: bun run golden   # output-identity gate");
console.log("      bun run bench:ab # before/after timings");
