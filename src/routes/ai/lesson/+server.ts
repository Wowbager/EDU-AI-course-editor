/**
 * Writing cards of one lesson with AI, one card a turn of one conversation; also a single
 * card („Dopsat kartu“), as a lesson of one. Not under `/api/`: the proxy sends that to
 * the Laravel API.
 *
 *   POST /ai/lesson  LessonRequest  → application/x-ndjson, one LessonEvent per line
 *     (`writing`, then `card` or `card-failed`, for each card; then `done`). With `resume`
 *     one card, then `turn` (what the conversation gained) and `done`.
 *
 * Same provider, key and limits as the other AI routes (`server/ai/route.ts`); each call
 * to the model counts.
 */
import { env } from '$env/dynamic/private';
import { MAX_CONTEXT_CHARS, MAX_MATERIALS_CHARS } from '$lib/domain/authoring';
import { lessonRequestSchema, MAX_RESUME_CHARS, MAX_TURN_CHARS } from '$lib/domain/lesson-writing';
import { lessonEvents } from '$lib/server/ai/lesson';
import { chatter } from '$lib/server/ai/provider';
import { eventStream, limitsFor, readAiRequest } from '$lib/server/ai/route';
import { loadPicture } from '$lib/server/images/instance';
import { ownerOf } from '$lib/server/versions/http';
import type { RequestHandler } from './$types';

// The lesson's dossier and materials, and with a plan the plan's request and answer too;
// from the second card on, the conversation so far.
const MAX_BODY =
	2 * (MAX_CONTEXT_CHARS + MAX_MATERIALS_CHARS) + MAX_TURN_CHARS + MAX_RESUME_CHARS + 300_000;

export const POST: RequestHandler = async ({ request }) => {
	const owner = ownerOf(request);
	const { config, body } = await readAiRequest(request, env, lessonRequestSchema, MAX_BODY);
	const limits = limitsFor(config, owner);
	if (limits instanceof Response) return limits;
	return eventStream(async (send, signal) => {
		for await (const event of lessonEvents(body, chatter(config, fetch, loadPicture), {
			...limits,
			signal
		}))
			send(event);
	});
};
