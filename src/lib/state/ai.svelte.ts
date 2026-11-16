/**
 * Writing a card with AI, as the editor sees it: whether it is on offer, which cards
 * are being written right now, and the one action that asks for a card and writes the
 * answer into the document.
 *
 * Whether AI is on offer is the server's to say (`GET /ai/block`): without a provider
 * configured there, nothing about AI is drawn at all.
 */
import { SvelteSet } from 'svelte/reactivity';
import {
	sourceRefsOf,
	describeWritten,
	fillCard,
	type GeneratedCard,
	type WrittenCount
} from '$lib/domain/authoring';
import { buildDossier } from '$lib/domain/dossier';
import {
	buildLessonRequest,
	lessonEventSchema,
	planEventSchema,
	type LessonEvent,
	type LessonRequest,
	type PlanEvent,
	type TurnMessage
} from '$lib/domain/lesson-writing';
import type { PlanRequest } from '$lib/domain/plan';
import { outlineEventSchema, type OutlineEvent, type OutlineRequest } from '$lib/domain/outline';
import { workspaceKey } from '$lib/state/versions/server';
import { renderMaterials } from '$lib/domain/materials';
import { usableSources, type Assigned, type SourcesRequest } from '$lib/domain/source-assign';
import { materials } from './materials.svelte';
import { notices } from './notice.svelte';
import type { DocStore } from './doc-store.svelte';

export const TEXT = {
	failed: 'Kartu se nepodařilo dopsat. Zkus to znovu.',
	busy: 'AI je teď přetížená. Zkus to za chvíli.',
	rate: 'To bylo moc požadavků najednou. Zkus to za chvíli.',
	budget: 'Dnešní příděl pro AI je vyčerpaný. Zítra to půjde znovu.',
	offline: 'Nepodařilo se spojit s AI. Zkontroluj připojení a zkus to znovu.'
} as const;

export type Problem = keyof typeof TEXT;
type Outcome = { card: GeneratedCard } | { problem: Problem; retryAfter?: number };

export type Failure = { problem: Problem; retryAfter?: number };

/** One POST to an AI route: the response of a 200, or what went wrong. */
async function send(
	route: string,
	request: unknown,
	signal?: AbortSignal
): Promise<{ response: Response } | Failure> {
	const key = workspaceKey();
	if (!key) return { problem: 'failed' };
	let response: Response;
	try {
		response = await fetch(route, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-editor-workspace': key },
			body: JSON.stringify(request),
			...(signal !== undefined ? { signal } : {})
		});
	} catch {
		return { problem: 'offline' };
	}
	if (response.status === 429) {
		const body = (await response.json().catch(() => null)) as { reason?: string } | null;
		const after = Number(response.headers.get('retry-after'));
		return {
			problem: body?.reason === 'budget' ? 'budget' : 'rate',
			...(Number.isFinite(after) && after > 0 ? { retryAfter: after } : {})
		};
	}
	if (response.status === 503) return { problem: 'busy' };
	if (!response.ok) return { problem: 'failed' };
	return { response };
}

async function post(route: string, request: unknown): Promise<{ body: unknown } | Failure> {
	const answer = await send(route, request);
	if ('problem' in answer) return answer;
	return { body: await answer.response.json().catch(() => null) };
}

/**
 * The lines of an answer of one JSON event per line, each to `take` as it arrives; empty
 * lines (the server's heartbeat) are skipped. `false` when the connection broke.
 */
async function readLines(response: Response, take: (json: unknown) => void): Promise<boolean> {
	const body = response.body;
	if (body === null) return false;
	const decoder = new TextDecoder();
	let rest = '';
	const line = (raw: string) => {
		if (raw.trim() === '') return;
		try {
			take(JSON.parse(raw));
		} catch {
			// A damaged line is skipped; the stream says how it ended.
		}
	};
	try {
		const reader = body.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (value !== undefined) rest += decoder.decode(value, { stream: !done });
			let at: number;
			while ((at = rest.indexOf('\n')) >= 0) {
				line(rest.slice(0, at));
				rest = rest.slice(at + 1);
			}
			if (done) break;
		}
		line(rest);
	} catch {
		return false;
	}
	return true;
}

/**
 * Ask for a proposal. Its events go to `onEvent` as the model writes them; the promise
 * says how it ended: `done`, or what went wrong (what arrived before stays with the caller).
 */
export async function askOutline(
	request: OutlineRequest,
	onEvent: (event: OutlineEvent) => void
): Promise<'done' | Failure> {
	const answer = await send('/ai/outline', request);
	if ('problem' in answer) return answer;
	let ended: 'done' | Failure | undefined;
	const read = await readLines(answer.response, (json) => {
		const event = outlineEventSchema.safeParse(json);
		if (!event.success) return;
		if (event.data.type === 'done') ended = 'done';
		else if (event.data.type === 'failed')
			ended = { problem: event.data.problem === 'busy' ? 'busy' : 'failed' };
		else onEvent(event.data);
	});
	if (!read) return { problem: 'offline' };
	// A stream that stops without saying so was cut.
	return ended ?? { problem: 'offline' };
}

/** How a lesson's conversation ended, when it did not end with every card answered. */
export type LessonEnd = 'done' | Failure;

/** What a lesson's request is given besides the request. */
export type LessonOptions = {
	/**
	 * Before each card after the first: what the teacher changed in the lesson since the
	 * conversation last knew it, or nothing. It goes into that card's message.
	 */
	changed?: () => string | undefined;
};

/**
 * Write the cards of a lesson: each event goes to `onEvent` as it comes. The conversation
 * is one request a card, the server handing back what each turn added, so that what the
 * teacher changed in between reaches the next one (`options.changed`). Aborting `signal`
 * ends the conversation (the card being written is lost); the promise then says `done`.
 */
export async function askLesson(
	request: LessonRequest,
	onEvent: (event: Exclude<LessonEvent, { type: 'done' | 'failed' | 'stopped' | 'turn' }>) => void,
	signal?: AbortSignal,
	options: LessonOptions = {}
): Promise<LessonEnd> {
	const messages: TurnMessage[] = [];
	for (let next = 0; next < request.cards.length; next++) {
		const changed = next > 0 ? options.changed?.() : undefined;
		const turn = await lessonTurn(
			{
				...request,
				resume: { next, messages, ...(changed !== undefined ? { changed } : {}) }
			},
			onEvent,
			signal
		);
		if (turn.end !== 'done') return turn.end;
		if (signal?.aborted) return 'done';
		// A turn that ends without handing its messages back was cut, unless none follows.
		if (turn.messages === undefined) {
			if (next < request.cards.length - 1) return { problem: 'offline' };
			continue;
		}
		messages.push(...turn.messages);
	}
	return 'done';
}

async function lessonTurn(
	request: LessonRequest,
	onEvent: (event: Exclude<LessonEvent, { type: 'done' | 'failed' | 'stopped' | 'turn' }>) => void,
	signal?: AbortSignal
): Promise<{ end: LessonEnd; messages?: TurnMessage[] }> {
	let answer: { response: Response } | Failure;
	try {
		answer = await send('/ai/lesson', request, signal);
	} catch {
		answer = { problem: 'offline' };
	}
	if (signal?.aborted) return { end: 'done' };
	if ('problem' in answer) return { end: answer };
	let ended: LessonEnd | undefined;
	let messages: TurnMessage[] | undefined;
	const read = await readLines(answer.response, (json) => {
		const event = lessonEventSchema.safeParse(json);
		if (!event.success) return;
		const e = event.data;
		if (e.type === 'done') ended = 'done';
		else if (e.type === 'failed') ended = { problem: e.problem };
		else if (e.type === 'stopped')
			ended = { problem: e.reason, ...(e.retryAfter > 0 ? { retryAfter: e.retryAfter } : {}) };
		else if (e.type === 'turn') messages = e.messages;
		else onEvent(e);
	});
	if (signal?.aborted) return { end: 'done' };
	if (!read) return { end: { problem: 'offline' } };
	return { end: ended ?? { problem: 'offline' }, ...(messages !== undefined ? { messages } : {}) };
}

/** Ask for the plan of the cards about to be written; what went wrong, or the plan. */
export async function askPlan(
	request: PlanRequest,
	signal?: AbortSignal
): Promise<Extract<PlanEvent, { type: 'plan' }> | Failure> {
	let answer: { response: Response } | Failure;
	try {
		answer = await send('/ai/plan', request, signal);
	} catch {
		return { problem: 'offline' };
	}
	if ('problem' in answer) return answer;
	let ended: Extract<PlanEvent, { type: 'plan' }> | Failure | undefined;
	const read = await readLines(answer.response, (json) => {
		const event = planEventSchema.safeParse(json);
		if (!event.success) return;
		const e = event.data;
		if (e.type === 'plan') ended = e;
		else if (e.type === 'failed') ended = { problem: e.problem };
		else ended = { problem: e.reason, ...(e.retryAfter > 0 ? { retryAfter: e.retryAfter } : {}) };
	});
	if (!read) return { problem: 'offline' };
	return ended ?? { problem: 'offline' };
}

/**
 * Ask which sections of the materials each card is written from. Nothing named, for any
 * reason, is an empty list: the cards are then written without sources.
 */
export async function askSources(request: SourcesRequest): Promise<Assigned> {
	const answer = await post('/ai/sources', request);
	if ('problem' in answer) return [];
	const body = answer.body as { status?: string; cards?: unknown } | null;
	if (body?.status !== 'ok') return [];
	// Checked again here: only the request's cards and the materials' keys.
	return usableSources(request, { cards: body.cards });
}

/** What `write` came to, for the queue that writes many cards. */
export type WriteResult =
	| { status: 'written' | 'nothing' | 'gone' }
	| { status: 'problem'; problem: Problem; retryAfter?: number };

class Ai {
	/** Whether the server has a provider. `false` until it has said so. */
	available = $state(false);
	/** Cards being written right now, by the view's card id. */
	writing = new SvelteSet<string>();

	/**
	 * Ask the server whether AI is on offer. Only its answer changes the offer: a
	 * request that did not get through says nothing about the provider.
	 */
	async detect(): Promise<void> {
		try {
			const response = await fetch('/ai/block');
			if (!response.ok) return;
			const body = (await response.json()) as { configured?: boolean };
			this.available = body.configured === true;
		} catch {
			// Unknown, so unchanged.
		}
	}

	/**
	 * Write the card: its empty parts and the steps the model adds, as a lesson of one
	 * card. What the teacher fills in while the model works is kept: `fillCard` looks
	 * again at what is empty when the answer arrives.
	 */
	async write(
		store: DocStore,
		blockId: string,
		lessonId: string | undefined,
		/** `quiet`: the caller reports problems and the result itself. */
		options: { quiet?: boolean } = {}
	): Promise<WriteResult> {
		if (this.writing.has(blockId)) return { status: 'nothing' };
		if (!store.doc.blocks.some((b) => b.block_id === blockId)) return { status: 'gone' };
		// Taken at once: a second click while the materials load must not write it twice.
		this.writing.add(blockId);
		try {
			return await this.#write(store, blockId, lessonId, options);
		} finally {
			this.writing.delete(blockId);
		}
	}

	async #write(
		store: DocStore,
		blockId: string,
		lessonId: string | undefined,
		options: { quiet?: boolean }
	): Promise<WriteResult> {
		// The card's sources, and the course's other materials by what fits (`renderMaterials`).
		await materials.ready(store.doc.course_id);
		const target = store.doc.blocks.find((b) => b.block_id === blockId);
		if (target === undefined) return { status: 'gone' };
		const lesson =
			lessonId ??
			store.doc.lessons.find((l) => l.blocks.some((b) => b.block_id === blockId))?.lesson_id;
		const built =
			lesson === undefined
				? undefined
				: buildLessonRequest(store.doc, lesson, [blockId], {
						context: buildDossier(store.doc, blockId, lesson),
						materials: renderMaterials(materials.sections, {
							for: 'lesson',
							refs: sourceRefsOf(target)
						})
					});
		if (built === undefined) return { status: 'nothing' };
		let card: GeneratedCard | undefined;
		let failedCard = false;
		const end = await askLesson(built.request, (event) => {
			if (event.type === 'card') card = event.answer;
			else if (event.type === 'card-failed') failedCard = true;
		});
		const outcome: Outcome =
			card !== undefined
				? { card }
				: end !== 'done'
					? end
					: { problem: failedCard ? 'failed' : 'offline' };
		if ('problem' in outcome) return this.#report(outcome, options);
		return this.apply(store, blockId, lessonId, outcome.card, options);
	}

	/** A problem said to the teacher (unless `quiet`), and as the result. */
	async #report(
		outcome: { problem: Problem; retryAfter?: number },
		options: { quiet?: boolean }
	): Promise<WriteResult> {
		// A 503 is also what a server that has lost its provider says: ask again, and if AI
		// is gone the offer goes with it.
		if (outcome.problem === 'busy') await this.detect();
		if (options.quiet !== true)
			notices.show({ text: TEXT[this.available ? outcome.problem : 'failed'] });
		return { status: 'problem', ...outcome };
	}

	/**
	 * A card the model wrote, into the document: its own undo step, never folded into a
	 * run of the teacher's typing, and only into parts that are still empty.
	 */
	apply(
		store: DocStore,
		blockId: string,
		lessonId: string | undefined,
		card: GeneratedCard,
		options: { quiet?: boolean } = {}
	): WriteResult {
		// The card may be gone by now; then there is nothing to write and nothing to say.
		if (!store.doc.blocks.some((b) => b.block_id === blockId)) return { status: 'gone' };
		let written: WrittenCount | undefined;
		store.endEdit();
		const before = store.undoStack.at(-1);
		// Where the teacher is now stays where they are: no selection change.
		store.apply((d, reserved) => {
			const result = fillCard(d, blockId, card, reserved);
			written = result.written;
			return { ...result, ref: undefined };
		});
		const entry = store.undoStack.at(-1);
		if (entry === before) return { status: 'nothing' };
		// One toast per card would bury a queue of twenty; the panel shows each as done.
		if (options.quiet !== true)
			notices.show({
				text: written ? describeWritten(written) : 'Karta dopsána.',
				entry,
				ref: { lessonId, blockId }
			});
		return { status: 'written' };
	}
}

export const ai = new Ai();
