import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * The domain layer is plain TypeScript and is tested without the SvelteKit plugin —
 * the invariants live here (plan §7), so these tests must be fast enough to run
 * on every change.
 */
export default defineConfig({
	// Only `.svelte` and `.svelte.ts` files go through the compiler — the state
	// classes use runes, and their tests need them compiled. Nothing else is touched,
	// so the domain suite is as fast as it was.
	plugins: [svelte({ configFile: false, compilerOptions: { runes: true } })],
	// `$lib` is SvelteKit's alias; the domain tests run without the plugin, so it is
	// declared here too. Only type-only imports cross into `.svelte.ts` modules.
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		environment: 'node',
		// `scripts/` holds `inject-player-shim.mjs`, shared by the dev player-serving
		// plugin and the production Docker build — tested here rather than only in
		// `src` because both callers live outside `src` too.
		include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
		globals: false
	}
});
