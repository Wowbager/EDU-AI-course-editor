/**
 * The in-app chat. Not under `/api/`: nginx sends that to the Laravel API.
 *
 *   GET  /ai/chat   → { configured: boolean }, for the top bar's button
 *   POST /ai/chat   { messages } → a server-sent event stream (`lib/agent/protocol.ts`)
 */
import { env } from '$env/dynamic/private';
import { SYSTEM_PROMPT, TOOLS } from '$lib/agent/server-prompt';
import { chatStatus, handleChat } from '$lib/server/ai/chat';
import { readAiConfig } from '$lib/server/ai/config';
import { sharedLimits } from '$lib/server/ai/limits';
import { streamChat } from '$lib/server/ai/provider';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => chatStatus(readAiConfig(env));

export const POST: RequestHandler = ({ request }) => {
	const config = readAiConfig(env);
	return handleChat(request, {
		config,
		limits: sharedLimits(config),
		system: SYSTEM_PROMPT,
		tools: TOOLS,
		stream: (params) => streamChat(params, config)
	});
};
