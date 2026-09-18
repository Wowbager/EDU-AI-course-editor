import { defineConfig, devices } from '@playwright/test';

/**
 * The four flows of plan §7. The editor is a desktop tool, so the viewport is the
 * 1440 it targets.
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	fullyParallel: true,
	// Every page in this suite boots the Flutter/CanvasKit player, so a worker costs
	// far more than a typical DOM test. Left at the default (half the cores) the suite
	// saturates the machine and fails a different test on each run; capped it is
	// deterministic, and no slower in wall-clock because the box was already the limit.
	workers: 4,
	use: {
		baseURL: 'http://localhost:5178',
		viewport: { width: 1440, height: 900 },
		locale: 'cs-CZ'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run dev -- --port 5178',
		url: 'http://localhost:5178',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
