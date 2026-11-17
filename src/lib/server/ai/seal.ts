/**
 * The server's signature on what it hands the browser to send back: the model's turns
 * of a lesson's conversation and the plan's turn (`domain/lesson-writing.ts`). The server
 * keeps nothing between requests, so without it a client could send any conversation as
 * the model's own and use the editor's key as a chat with no system prompt in charge.
 *
 * The key is derived from the provider's key, so it outlives a restart and needs no
 * setting of its own; a new provider key ends the conversations in progress.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
	assistantTurnSchema,
	turnMessageSchema,
	type LessonEvent,
	type LessonRequest,
	type PlanEvent
} from '$lib/domain/lesson-writing';
import type { AiConfig } from './config';

export type SealKey = Buffer;

export function sealKey(config: Pick<AiConfig, 'apiKey' | 'provider'>): SealKey {
	return createHash('sha256')
		.update('eduai.turn-seal/1\0')
		.update(config.apiKey || config.provider)
		.digest();
}

/** The same text on the way out and back: what the schema keeps, as JSON. */
const turnsText = (messages: unknown) => JSON.stringify(z.array(turnMessageSchema).parse(messages));
const planText = (turn: unknown) => JSON.stringify(assistantTurnSchema.parse(turn));

function sign(key: SealKey, kind: string, text: string): string {
	return createHmac('sha256', key).update(kind).update('\0').update(text).digest('base64url');
}

function same(a: string, b: string | undefined): boolean {
	if (b === undefined) return false;
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/** The seal of a lesson's conversation so far: every message after its opening. */
export const sealTurns = (key: SealKey, messages: unknown) =>
	sign(key, 'turns', turnsText(messages));

export const turnsSealed = (key: SealKey, messages: unknown, seal: string | undefined) =>
	same(sealTurns(key, messages), seal);

/** The seal of the plan's accepted turn. */
export const sealPlan = (key: SealKey, turn: unknown) => sign(key, 'plan', planText(turn));

export const planSealed = (key: SealKey, turn: unknown, seal: string | undefined) =>
	same(sealPlan(key, turn), seal);

/**
 * Whether what a lesson request hands back is the server's own: the plan's turn and the
 * conversation so far, each with its seal. A conversation not begun has nothing to seal.
 */
export function lessonRequestSealed(key: SealKey, request: LessonRequest): boolean {
	if (request.plan !== undefined && !planSealed(key, request.plan.turn, request.plan.seal))
		return false;
	const resume = request.resume;
	if (resume !== undefined && resume.messages.length > 0)
		return turnsSealed(key, resume.messages, resume.seal);
	return true;
}

/** A lesson's event as it goes out: a `turn` sealed with the conversation it completes. */
export function sealLessonEvent(
	key: SealKey,
	request: LessonRequest,
	event: LessonEvent
): LessonEvent {
	if (event.type !== 'turn') return event;
	const all = [...(request.resume?.messages ?? []), ...event.messages];
	return { ...event, seal: sealTurns(key, all) };
}

/** The plan's answer as it goes out, its turn sealed. */
export function sealPlanEvent(key: SealKey, event: PlanEvent): PlanEvent {
	return event.type === 'plan' ? { ...event, seal: sealPlan(key, event.turn) } : event;
}
