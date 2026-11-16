/**
 * Whether the editor may offer AI. Not under `/api/`: the proxy sends that to the Laravel API.
 *
 *   GET  /ai/block  → { configured }
 *
 * Cards are written through `/ai/lesson`, a single card as a lesson of one. The
 * provider's key stays on the server.
 */
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { isConfigured, readAiConfig } from '$lib/server/ai/config';
import type { RequestHandler } from './$types';

const NO_STORE = { headers: { 'cache-control': 'no-store' } };

export const GET: RequestHandler = () =>
	json({ configured: isConfigured(readAiConfig(env)) }, NO_STORE);
