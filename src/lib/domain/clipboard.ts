/**
 * What Ctrl+C puts on the clipboard for a card or a step, and reading it back.
 *
 * Plain JSON text, so it travels between tabs, windows and courses through the system
 * clipboard, and a paste anywhere else shows something readable. The `edu_ai_editor`
 * key is what tells a copied card from text a teacher copied out of a field.
 */
import { z } from 'zod';
import { blockSchema, blockStepSchema, type BlockStep, type BlockV2 } from './schema';
import { deepCopy } from './clone';

const MARK = 'edu_ai_editor';
const VERSION = 1;

export type Clipboard = { kind: 'card'; block: BlockV2 } | { kind: 'step'; step: BlockStep };

const payloadSchema = z.discriminatedUnion('kind', [
	z.looseObject({ [MARK]: z.literal(VERSION), kind: z.literal('card'), block: blockSchema }),
	z.looseObject({ [MARK]: z.literal(VERSION), kind: z.literal('step'), step: blockStepSchema })
]);

/** A card (as the teacher sees it, `store.doc`) or one of its steps, as clipboard text. */
export function toClipboard(block: BlockV2, stepId?: string): string | null {
	if (stepId !== undefined) {
		const step = block.steps.find((s) => s.id === stepId);
		if (step === undefined) return null;
		return JSON.stringify({ [MARK]: VERSION, kind: 'step', step: deepCopy(step) }, null, 2);
	}
	return JSON.stringify({ [MARK]: VERSION, kind: 'card', block: deepCopy(block) }, null, 2);
}

/** A copied card or step, or null for any other text — that is pasted as text. */
export function fromClipboard(text: string): Clipboard | null {
	if (!text.includes(MARK)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	const parsed = payloadSchema.safeParse(raw);
	if (!parsed.success) return null;
	return parsed.data.kind === 'card'
		? { kind: 'card', block: parsed.data.block as BlockV2 }
		: { kind: 'step', step: parsed.data.step as BlockStep };
}
