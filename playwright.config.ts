import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PlayerKind } from './e2e/fixtures.ts';

/**
 * Two projects, split by what a suite needs from the preview column.
 *
 *  - `editor`: everything about the editor itself. The preview column gets the
 *    fake player (`e2e/fake-player.html`, see `e2e/fixtures.ts`), which loads in no
 *    time, so these run fully parallel.
 *  - `player`: the suites about the preview (`preview*.spec.ts`), against the real
 *    Flutter build. Each page boots the whole player, about 11 MB of JavaScript and
 *    several MB of wasm. Four at once saturated the machine and failed a
 *    different test on each run, so this project is held to two workers.
 *
 * The server is the built editor (`vite build` + `vite preview`), not the dev
 * server. A cold dev server compiles every module on the first page load, which
 * left a long window for a dropped connection to kill the load.
 * `E2E_DEV=1` uses the dev server instead, for a quick loop while editing a spec.
 *
 * The viewport below is 1440, but `devices['Desktop Chrome']` in each project
 * replaces it with 1280×720, and that is the size the suites were written at.
 *
 * The server the suites start keeps its versions and uploads in a directory of its
 * own under the system's temporary directory, never in the checkout's data
 * directory: every test page is a new workspace, and thousands of them do not belong
 * beside a person's own saved versions. A server already running is reused as it
 * is, with whatever directory it was started with.
 */
// Matched against the absolute path, so anchored to the file name: a checkout in a
// directory with "preview" in its name must not match every spec.
const PLAYER_SPECS = /\/preview[^/]*\.spec\.ts$/;
const dev = Boolean(process.env.E2E_DEV);
const ci = Boolean(process.env.CI);

export default defineConfig<{ player: PlayerKind }>({
	testDir: 'e2e',
	timeout: 30_000,
	fullyParallel: true,
	workers: 6,
	// A `.only` left in a suite must fail the build, not quietly skip the rest.
	forbidOnly: ci,
	// The HTML report is what the workflow uploads when a run fails.
	reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: 'http://localhost:5178',
		viewport: { width: 1440, height: 900 },
		locale: 'cs-CZ'
	},
	projects: [
		{
			name: 'editor',
			testIgnore: PLAYER_SPECS,
			use: { ...devices['Desktop Chrome'], player: 'fake' }
		},
		{
			name: 'player',
			testMatch: PLAYER_SPECS,
			workers: 2,
			use: { ...devices['Desktop Chrome'], player: 'real' }
		}
	],
	webServer: {
		command: dev
			? 'npm run dev -- --port 5178 --strictPort'
			: 'npm run build && npm run preview -- --port 5178 --strictPort',
		url: 'http://localhost:5178',
		env: { DATA_DIR: join(tmpdir(), 'editor-e2e-data') },
		reuseExistingServer: !ci,
		timeout: dev ? 60_000 : 180_000
	}
});
