import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e",
	timeout: 30_000,
	use: {
		baseURL: "http://localhost:4173",
	},
	webServer: {
		command: "bun run preview --port 4173 --strictPort",
		port: 4173,
		reuseExistingServer: true,
	},
});
