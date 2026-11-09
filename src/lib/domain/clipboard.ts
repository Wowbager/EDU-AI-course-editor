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
import type { CopiedFrom } from './commands';

const MARK = 'edu_ai_editor';
const VERSION = 1;

export type Clipboard = { from: CopiedFrom } & (
	{ kind: 'card'; block: BlockV2 } | { kind: 'step'; step: BlockStep }
);

const origin = {
	course_id: z.string().optional(),
	block_id: z.string().optional()
};
const payloadSchema = z.discriminatedUnion('kind', [
	z.looseObject({
		[MARK]: z.literal(VERSION),
		kind: z.literal('card'),
		...origin,
		block: blockSchema
	}),
	z.looseObject({
		[MARK]: z.literal(VERSION),
		kind: z.literal('step'),
		...origin,
		step: blockStepSchema
	})
]);

/**
 * A card (as the teacher sees it, `store.doc`) or one of its steps, as clipboard text.
 * It says which course and card it came from: step and card ids mean something only
 * there (`pasteBlock`, `pasteStep`).
 */
export function toClipboard(courseId: string, block: BlockV2, stepId?: string): string | null {
	const head = { [MARK]: VERSION, course_id: courseId, block_id: block.block_id };
	if (stepId !== undefined) {
		const step = block.steps.find((s) => s.id === stepId);
		if (step === undefined) return null;
		return JSON.stringify({ ...head, kind: 'step', step: deepCopy(step) }, null, 2);
	}
	return JSON.stringify({ ...head, kind: 'card', block: deepCopy(block) }, null, 2);
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
	const data = parsed.data;
	const from: CopiedFrom = { courseId: data.course_id, blockId: data.block_id };
	return data.kind === 'card'
		? { from, kind: 'card', block: data.block as BlockV2 }
		: { from, kind: 'step', step: data.step as BlockStep };
}
