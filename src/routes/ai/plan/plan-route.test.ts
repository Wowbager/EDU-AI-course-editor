import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONTEXT_CHARS } from '$lib/domain/authoring';
import { addBlock, addLesson } from '$lib/domain/commands';
import { emptyCourse } from '$lib/domain/document';
import { planEventSchema } from '$lib/domain/lesson-writing';
import { buildPlanRequest, type PlanRequest } from '$lib/domain/plan';

const state = vi.hoisted(() => ({ env: {} as Record<string, string>, owner: 'owner' }));
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({}, { get: (_t, key) => state.env[key as string] })
}));
vi.mock('$lib/server/versions/http', () => ({ ownerOf: () => state.owner }));

import { POST } from './+server';

/** The plan's request for two lessons of two cards. */
function planRequest(context = 'KURZ: Zlomky'): PlanRequest {
	let doc = emptyCourse('KURZ', 'Zlomky');
	const cards: { blockId: string; lessonId: string }[] = [];
	for (const name of ['Polovina', 'Čtvrtina']) {
		doc = addLesson(doc, name).doc;
		const lessonId = doc.lessons.at(-1)!.lesson_id;
		for (const type of ['display', 'exercise'] as const) {
			const added = addBlock(doc, lessonId, type);
			doc = added.doc;
			cards.push({ blockId: added.ref!.blockId!, lessonId });
		}
	}
	return buildPlanRequest(doc, cards, context)!.request;
}

const post = (body: unknown) =>
	POST({
		request: new Request('http://x/ai/plan', {
			method: 'POST',
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as never);

const eventsOf = async (response: Response) => {
	expect(response.status).toBe(200);
	return (await response.text())
		.split('\n')
		.filter((line) => line !== '')
		.map((line) => JSON.parse(line));
};

let n = 0;
beforeEach(() => {
	state.env = { AI_PROVIDER: 'fake', AI_DAILY_TOKEN_BUDGET: String(2_000_000 + ++n) };
	state.owner = `owner-${n}`;
});

describe('POST /ai/plan', () => {
	it("streams one plan event covering every card, with the model's turn", async () => {
		const response = await post(planRequest());
		expect(response.headers.get('content-type')).toBe('application/x-ndjson');
		const events = await eventsOf(response);
		expect(events).toHaveLength(1);
		expect(planEventSchema.safeParse(events[0]).success).toBe(true);
		expect(events[0].type).toBe('plan');
		expect(events[0].plan.cards.map((c: { card: number }) => c.card)).toEqual([1, 2, 3, 4]);
		expect(events[0].plan.lessons.map((l: { lesson: number }) => l.lesson)).toEqual([1, 2]);
		expect(events[0].turn).toMatchObject({ role: 'assistant' });
		expect(events[0].turn).not.toHaveProperty('reasoning_details');
	});

	it('answers 400 to a body that is not JSON or not a plan request', async () => {
		await expect(post('{nope')).rejects.toMatchObject({ status: 400 });
		await expect(post({ schema: 'eduai.plan-request/1' })).rejects.toMatchObject({ status: 400 });
		await expect(post({ ...planRequest(), lessons: [] })).rejects.toMatchObject({ status: 400 });
	});

	it('answers 503 when AI is not configured', async () => {
		state.env = {};
		await expect(post(planRequest())).rejects.toMatchObject({ status: 503 });
	});

	it('answers 413 to a dossier past the limit and to a body past the size limit', async () => {
		await expect(post(planRequest('x'.repeat(MAX_CONTEXT_CHARS + 1)))).rejects.toMatchObject({
			status: 413
		});
		await expect(post('x'.repeat(2_000_000))).rejects.toMatchObject({ status: 413 });
	});

	it("answers 429 with retry-after when the minute's limit is already used up", async () => {
		state.env.AI_MAX_REQUESTS_PER_MINUTE = '1';
		await eventsOf(await post(planRequest()));
		const response = await post(planRequest());
		expect(response.status).toBe(429);
		expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
		expect(await response.json()).toEqual({ reason: 'rate' });
	});
});
