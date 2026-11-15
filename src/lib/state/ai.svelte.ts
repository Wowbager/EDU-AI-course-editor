/**
 * Writing a card with AI, as the editor sees it: whether it is on offer, which cards
 * are being written right now, and the one action that asks for a card and writes the
 * answer into the document.
 *
 * Whether AI is on offer is the server's to say (`GET /ai/block`): without a provider
 * configured there, nothing about AI is drawn at all.
 */
import { SvelteSet } from 'svelte/reactivity';
import { buildGenRequest, fillBlock, generatedSchema, type Generated } from '$lib/domain/authoring';
import { workspaceKey } from '$lib/state/versions/server';
import { notices } from './notice.svelte';
import type { DocStore } from './doc-store.svelte';

const TEXT = {
	failed: 'Kartu se nepodařilo dopsat. Zkus to znovu.',
	busy: 'AI je teď přetížená. Zkus to za chvíli.',
	rate: 'To bylo moc požadavků najednou. Zkus to za chvíli.',
	budget: 'Dnešní příděl pro AI je vyčerpaný. Zítra to půjde znovu.',
	offline: 'Nepodařilo se spojit s AI. Zkontroluj připojení a zkus to znovu.'
} as const;

type Outcome = { block: Generated } | { problem: keyof typeof TEXT };

async function ask(request: unknown): Promise<Outcome> {
	const key = workspaceKey();
	if (!key) return { problem: 'failed' };
	let response: Response;
	try {
		response = await fetch('/ai/block', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-editor-workspace': key },
			body: JSON.stringify(request)
		});
	} catch {
		return { problem: 'offline' };
	}
	if (response.status === 429) {
		const body = (await response.json().catch(() => null)) as { reason?: string } | null;
		return { problem: body?.reason === 'budget' ? 'budget' : 'rate' };
	}
	if (response.status === 503) return { problem: 'busy' };
	if (!response.ok) return { problem: 'failed' };
	const body = (await response.json().catch(() => null)) as {
		status?: string;
		block?: unknown;
	} | null;
	const block = generatedSchema.safeParse(body?.block);
	if (body?.status !== 'ok' || !block.success) return { problem: 'failed' };
	return { block: block.data };
}

class Ai {
	/** Whether the server has a provider. `false` until it has said so. */
	available = $state(false);
	/** Cards being written right now, by the view's card id. */
	writing = new SvelteSet<string>();

	/** Ask the server once whether AI is on offer. */
	async detect(): Promise<void> {
		try {
			const response = await fetch('/ai/block');
			const body = (await response.json()) as { configured?: boolean };
			this.available = response.ok && body.configured === true;
		} catch {
			this.available = false;
		}
	}

	/**
	 * Write the card's empty parts. What the teacher fills in while the model works is
	 * kept: `fillBlock` looks again at what is empty when the answer arrives.
	 */
	async write(store: DocStore, blockId: string, lessonId: string | undefined): Promise<void> {
		if (this.writing.has(blockId)) return;
		const request = buildGenRequest(store.doc, blockId, lessonId);
		if (request === undefined) return;
		this.writing.add(blockId);
		let outcome: Outcome;
		try {
			outcome = await ask(request);
		} finally {
			this.writing.delete(blockId);
		}
		if ('problem' in outcome) {
			notices.show({ text: TEXT[outcome.problem] });
			return;
		}
		// The card may be gone by now; then there is nothing to write and nothing to say.
		if (!store.doc.blocks.some((b) => b.block_id === blockId)) return;
		const { block } = outcome;
		const before = store.undoStack.at(-1);
		// Where the teacher is now stays where they are: no selection change.
		store.apply((d, reserved) => ({ ...fillBlock(d, blockId, block, reserved), ref: undefined }));
		const entry = store.undoStack.at(-1);
		if (entry === before) return;
		notices.show({ text: 'Karta dopsána.', entry, ref: { lessonId, blockId } });
	}
}

export const ai = new Ai();
