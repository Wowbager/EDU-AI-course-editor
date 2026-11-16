/**
 * Planning the cards the teacher just accepted, before any is written. Not under `/api/`:
 * the proxy sends that to the Laravel API.
 *
 *   POST /ai/plan  PlanRequest  → application/x-ndjson: one PlanEvent (the plan and the
 *     model's turn, to be handed back with each lesson), after empty lines while it thinks
 *
 * Same provider, key and limits as the other AI routes (`server/ai/route.ts`).
 */
import { env } from '$env/dynamic/private';
import { MAX_CONTEXT_CHARS, MAX_MATERIALS_CHARS } from '$lib/domain/authoring';
import { planRequestSchema } from '$lib/domain/plan';
import { makePlan } from '$lib/server/ai/lesson';
import { chatter } from '$lib/server/ai/provider';
import { eventStream, limitsFor, readAiRequest } from '$lib/server/ai/route';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

const MAX_BODY = MAX_CONTEXT_CHARS + MAX_MATERIALS_CHARS + 200_000;

export const POST: RequestHandler = async ({ request }) => {
	const owner = ownerOf(request);
	const { config, body } = await readAiRequest(request, env, planRequestSchema, MAX_BODY);
	const limits = limitsFor(config, owner);
	if (limits instanceof Response) return limits;
	return eventStream(async (send, signal) => {
		send(await makePlan(body, chatter(config), { ...limits, signal }));
	});
};
