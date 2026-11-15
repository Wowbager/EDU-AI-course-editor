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
	buildGenRequest,
	describeWritten,
	fillCard,
	generatedCardSchema,
	type GeneratedCard,
	type WrittenCount
} from '$lib/domain/authoring';
import { buildDossier } from '$lib/domain/dossier';
import { outlineEventSchema, type OutlineEvent, type OutlineRequest } from '$lib/domain/outline';
import { workspaceKey } from '$lib/state/versions/server';
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

type Failure = { problem: Problem; retryAfter?: number };

/** One POST to an AI route: the response of a 200, or what went wrong. */
async function send(route: string, request: unknown): Promise<{ response: Response } | Failure> {
	const key = workspaceKey();
	if (!key) return { problem: 'failed' };
	let response: Response;
	try {
		response = await fetch(route, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-editor-workspace': key },
			body: JSON.stringify(request)
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

async function ask(request: unknown): Promise<Outcome> {
	const answer = await post('/ai/block', request);
	if ('problem' in answer) return answer;
	const body = answer.body as { status?: string; card?: unknown } | null;
	const card = generatedCardSchema.safeParse(body?.card);
	if (body?.status !== 'ok' || !card.success) return { problem: 'failed' };
	return { card: card.data };
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
	const body = answer.response.body;
	if (body === null) return { problem: 'failed' };
	const decoder = new TextDecoder();
	let rest = '';
	let ended: 'done' | Failure | undefined;
	const take = (raw: string) => {
		if (raw.trim() === '') return;
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			return;
		}
		const event = outlineEventSchema.safeParse(json);
		if (!event.success) return;
		if (event.data.type === 'done') ended = 'done';
		else if (event.data.type === 'failed')
			ended = { problem: event.data.problem === 'busy' ? 'busy' : 'failed' };
		else onEvent(event.data);
	};
	try {
		const reader = body.getReader();
		for (;;) {
			const { value, done } = await reader.read();
			if (value !== undefined) rest += decoder.decode(value, { stream: !done });
			let at: number;
			while ((at = rest.indexOf('\n')) >= 0) {
				take(rest.slice(0, at));
				rest = rest.slice(at + 1);
			}
			if (done) break;
		}
		take(rest);
	} catch {
		return { problem: 'offline' };
	}
	// A stream that stops without saying so was cut.
	return ended ?? { problem: 'offline' };
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
	 * Write the card: its empty parts and the steps the model adds. What the teacher
	 * fills in while the model works is kept: `fillCard` looks again at what is empty
	 * when the answer arrives.
	 */
	async write(
		store: DocStore,
		blockId: string,
		lessonId: string | undefined,
		/** `quiet`: the caller reports problems and the result itself (the panel's queue). */
		options: { quiet?: boolean } = {}
	): Promise<WriteResult> {
		if (this.writing.has(blockId)) return { status: 'nothing' };
		if (!store.doc.blocks.some((b) => b.block_id === blockId)) return { status: 'gone' };
		const request = buildGenRequest(
			store.doc,
			blockId,
			lessonId,
			buildDossier(store.doc, blockId, lessonId)
		);
		if (request === undefined) return { status: 'nothing' };
		this.writing.add(blockId);
		let outcome: Outcome;
		try {
			outcome = await ask(request);
		} finally {
			this.writing.delete(blockId);
		}
		if ('problem' in outcome) {
			// A 503 is also what a server that has lost its provider says: ask again, and
			// if AI is gone the offer goes with it.
			if (outcome.problem === 'busy') await this.detect();
			if (options.quiet !== true)
				notices.show({ text: TEXT[this.available ? outcome.problem : 'failed'] });
			return { status: 'problem', ...outcome };
		}
		// The card may be gone by now; then there is nothing to write and nothing to say.
		if (!store.doc.blocks.some((b) => b.block_id === blockId)) return { status: 'gone' };
		const { card } = outcome;
		let written: WrittenCount | undefined;
		// Its own undo step: never folded into a run of the teacher's typing.
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
