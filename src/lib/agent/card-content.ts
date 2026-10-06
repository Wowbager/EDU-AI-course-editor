/**
 * What a card holds, for an agent, restricted to what the editor shows in the current
 * mode — INTERIM.
 *
 * The card editor still draws from the document (OPEN-PROBLEMS: the card region of the
 * screen model, Phase 0 part 3). Until `store.screen.card` exists this is the one place
 * an agent learns a card's content, and it follows the rule the model will: a field the
 * mode (or the Zpětná vazba toggle) does not show is not in `fields`, and the response
 * lists it under `hidden_in_mode` so the agent knows it exists and is not on screen.
 * When the card region lands, `get_card` and `search_text` switch to it and this file is
 * deleted; nothing else reads a card's fields.
 *
 * `address` is the path a write tool takes. It is an address, not content: the editor
 * shows ids only in Pokročilý, so the agent is told never to say one to the teacher.
 */
import type { BlockV2 } from '$lib/domain/schema';
import { refToJsonPath, type Ref } from '$lib/domain/ref';
import { FIELDS, MODE_RANK, fieldSpec, visible, type FieldLevel, type Mode } from '$lib/ui/fields';

export interface HiddenField {
	/** Where the field is, in words of the registry: `krok › Poznámka`. */
	field: string;
	/** The lowest mode that shows it; null when only the Zpětná vazba toggle hides it. */
	needs_mode: Mode | null;
	reason: 'mode' | 'feedback_off';
}

export interface CardContent {
	address: string;
	fields: Record<string, unknown>;
	steps: {
		address: string;
		fields: Record<string, unknown>;
		question: {
			fields: Record<string, unknown>;
			options: { address: string; fields: Record<string, unknown> }[];
		} | null;
	}[];
	hidden_in_mode: HiddenField[];
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export function cardContent(block: BlockV2, mode: Mode, feedback: boolean): CardContent {
	const hidden: HiddenField[] = [];

	/** Copy `node` key by key, dropping what `level`'s registry does not show here. */
	const filter = (node: Plain, level: FieldLevel, skip: string[], prefix = ''): Plain => {
		const out: Plain = {};
		for (const [key, value] of Object.entries(node)) {
			if (prefix === '' && skip.includes(key)) continue;
			const path = prefix + key;
			const exact = fieldSpec(level, path);
			const container = FIELDS.some((s) => s.level === level && s.path.startsWith(`${path}.`));
			const ancestor = FIELDS.filter(
				(s) => s.level === level && path.startsWith(`${s.path}.`)
			).sort((a, b) => b.path.length - a.path.length)[0];
			const spec = exact ?? (container && isPlain(value) ? undefined : ancestor);
			if (spec === undefined && container && isPlain(value)) {
				const inner = filter(value, level, skip, `${path}.`);
				if (Object.keys(inner).length > 0) out[key] = inner;
				continue;
			}
			if (spec !== undefined && !visible(spec, mode, feedback)) {
				const byMode = MODE_RANK[mode] < MODE_RANK[spec.mode];
				hidden.push({
					field: `${level} › ${spec.label}`,
					needs_mode: byMode ? spec.mode : null,
					reason: byMode ? 'mode' : 'feedback_off'
				});
				continue;
			}
			out[key] = value;
		}
		return out;
	};

	const fields = filter(block as unknown as Plain, 'block', ['steps']);
	const steps = block.steps.map((step) => {
		const stepRef: Ref = { blockId: block.block_id, stepId: step.id };
		const stepFields = filter(step as unknown as Plain, 'step', ['question']);
		const q = step.question as unknown as Plain | undefined;
		return {
			address: refToJsonPath(stepRef),
			fields: stepFields,
			question:
				q === undefined
					? null
					: {
							fields: filter(q, 'question', ['options']),
							options: (step.question?.options ?? []).map((o) => ({
								address: refToJsonPath({ ...stepRef, optionId: o.id }),
								fields: filter(o as unknown as Plain, 'option', [])
							}))
						}
		};
	});
	// Hidden entries repeat for every step and option; say each once.
	const seen = new Set<string>();
	const unique = hidden.filter((h) => {
		const key = `${h.field}|${h.reason}`;
		return seen.has(key) ? false : (seen.add(key), true);
	});
	return {
		address: refToJsonPath({ blockId: block.block_id }),
		fields,
		steps,
		hidden_in_mode: unique
	};
}
