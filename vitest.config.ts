import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The domain layer is plain TypeScript and is tested without the SvelteKit plugin —
 * the invariants live here (plan §7), so these tests must be fast enough to run
 * on every change.
 */
export default defineConfig({
	// `$lib` is SvelteKit's alias; the domain tests run without the plugin, so it is
	// declared here too. Only type-only imports cross into `.svelte.ts` modules.
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) }
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		globals: false
	}
});
