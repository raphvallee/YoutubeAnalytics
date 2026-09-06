/// <reference types="vitest/config" />
import fs from "node:fs/promises";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const BASE = "/YoutubeAnalytics/";

/**
 * Dev-only endpoint for example mode: streams the gitignored watch-history.json
 * from the repo root so dev navigation doesn't require a fresh Takeout upload.
 * Never runs during build, so the file can't leak into a deployed bundle.
 */
function exampleHistoryPlugin(): Plugin {
	return {
		name: "dev-example-watch-history",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? "").split("?")[0];
				const endpoint = `${BASE}dev/watch-history.json`;
				if (
					req.method !== "GET" ||
					(url !== endpoint && url !== "/dev/watch-history.json")
				) {
					next();
					return;
				}
				const file = path.resolve(import.meta.dirname, "watch-history.json");
				fs.readFile(file).then(
					(data) => {
						res.setHeader("Content-Type", "application/json");
						res.setHeader("Content-Length", data.byteLength);
						res.end(data);
					},
					() => {
						res.statusCode = 404;
						res.setHeader("Content-Type", "application/json");
						res.end(
							JSON.stringify({
								error:
									"No watch-history.json in the project root - example mode has nothing to serve.",
							}),
						);
					},
				);
			});
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	// GitHub Pages project site: https://<user>.github.io/YoutubeAnalytics/
	base: BASE,
	plugins: [exampleHistoryPlugin(), react(), tailwindcss()],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "./src"),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
