import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * The agent eval suite (`evals/agent/`): the real provider, the real tools, the corpus
 * fixtures. Run by hand with `npm run eval:agent`; it needs `AI_API_KEY` (in the
 * environment or `.env`), costs a few cents and is never part of `npm test` or CI.
 */
export default defineConfig(({ mode }) => ({
	plugins: [svelte({ configFile: false, compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: {
		environment: 'node',
		include: ['evals/agent/**/*.eval.ts'],
		// Scenarios run one after the other: they share a provider's rate limit.
		fileParallelism: false,
		testTimeout: 360_000,
		hookTimeout: 60_000,
		env: loadEnv(mode, process.cwd(), 'AI_')
	}
}));
