/**
 * A test-only window onto `store.screen`, for the screen-parity suite
 * (`e2e/screen-parity.spec.ts`): it reads the regions through the same `screenSlice`
 * an AI tool uses and compares them with what is on the page.
 *
 * It exists in the development server and in a build made with `--mode e2e` (what
 * Playwright's web server runs), and in no production build: Vite replaces
 * `import.meta.env.MODE` with the literal, so the whole body below is dropped from a
 * `vite build` without `--mode e2e`.
 */
import { screenSlice } from '$lib/screen/serialise';
import type { Screen, ScreenRegion } from '$lib/screen/types';
import type { DocStore } from './doc-store.svelte';

const REGIONS: ScreenRegion[] = ['topbar', 'tree', 'issues', 'preview', 'notices', 'ui', 'ai'];

export interface ScreenHook {
	/** Every region, as plain JSON. */
	all(): Screen;
}

declare global {
	interface Window {
		__screen?: ScreenHook;
	}
}

export function exposeScreen(store: DocStore): void {
	if (!(import.meta.env.DEV || import.meta.env.MODE === 'e2e')) return;
	window.__screen = {
		all: () =>
			Object.fromEntries(REGIONS.map((r) => [r, screenSlice(store.screen, r)])) as unknown as Screen
	};
}
