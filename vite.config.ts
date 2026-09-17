import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { playerPlugin } from './vite-plugin-player';

export default defineConfig({
	// In production nginx puts the API on this origin (see nginx.conf). In dev the
	// same path is proxied, so the editor's code never needs to know which it is.
	server: {
		proxy: {
			'/api': {
				target: process.env.API_URL ?? 'https://app-api.edu-ai.eu',
				changeOrigin: true,
				secure: true
			}
		}
	},
	plugins: [
		// The Flutter player, on this origin, so the preview works in development too.
		playerPlugin(process.env.PLAYER_BUILD ?? '../EDU-AI-asistent-APP/build/web'),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node, to match how the Flutter app is deployed (plan §2).
			adapter: adapter()
		})
	]
});
