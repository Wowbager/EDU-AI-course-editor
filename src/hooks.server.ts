/**
 * Headers on everything the editor's server answers. The editor is framed by nothing but
 * itself, a response is the type it says, and a link out does not carry the page's path.
 * The player (`/player/`) is served beside it and sends its own (`nginx.conf`).
 */
import type { Handle } from '@sveltejs/kit';

export const SECURITY_HEADERS = {
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'SAMEORIGIN',
	'referrer-policy': 'strict-origin-when-cross-origin'
} as const;

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		try {
			if (!response.headers.has(name)) response.headers.set(name, value);
		} catch {
			// A response whose headers cannot change (one passed on as it came) keeps its own.
		}
	}
	return response;
};
