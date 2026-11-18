/**
 * What the AI may write where, so that it uses Markdown and formulas only in fields the
 * app draws as Markdown. Taken from the editor's own field table (`fields.ts`, `markdown`)
 * and from the dialects of the visual editors (`domain/markdown`), not written down a
 * second time: one function makes the lines both prompts (the card's and the proposal's)
 * carry, and `ai-format.test.ts` fails when a field's kind changes and the rules do not.
 *
 * `FORMATTED` is the list of fields the rules speak of. A field that has a `markdown`
 * kind in `fields.ts` and is not in it fails the test, so a new one cannot be forgotten.
 */
import { ALWAYS_MARKDOWN, INLINE, SNIFFED, type MarkdownDialect } from '$lib/domain/markdown';
import { fieldSpec, type FieldSpec } from '$lib/ui/fields';

type Where = { level: FieldSpec['level']; path: string };

interface Formatted {
	/** What the model calls it in its answer. */
	key: string;
	/** What it is, for the model. */
	what: string;
	/** Where `fields.ts` has it; its `markdown` kind decides the dialect. */
	spec?: Where;
	/** Where the editor's own control fixes the dialect (the answer table, the step text). */
	dialect?: MarkdownDialect;
	/** Headings are a product rule for the short fields, not the dialect's. */
	headings: boolean;
}

export const FORMATTED: readonly Formatted[] = [
	{
		key: 'content_md',
		what: 'a text step, and the task of a question',
		dialect: SNIFFED,
		headings: true
	},
	{ key: 'hint_md', what: 'the hint', spec: { level: 'step', path: 'hint' }, headings: false },
	{
		key: 'help_md',
		what: 'the detailed help',
		spec: { level: 'step', path: 'help' },
		headings: false
	},
	{
		key: 'solution_md',
		what: 'the solution',
		spec: { level: 'question', path: 'solution' },
		headings: false
	},
	{ key: 'option text', what: 'the text of an answer option', dialect: INLINE, headings: false },
	{ key: 'option feedback', what: 'the reaction to an option', dialect: SNIFFED, headings: false },
	// No `markdown` in `fields.ts`: a plain-text field.
	{
		key: 'open answer',
		what: 'the answer of an open question',
		spec: { level: 'question', path: 'correct_answer' },
		headings: false
	}
];

/** The fields of the table that carry a `markdown` kind, as `level.path`. */
export const MARKDOWN_SPECS: readonly Where[] = FORMATTED.flatMap((f) =>
	f.spec !== undefined && fieldSpec(f.spec.level, f.spec.path)?.markdown !== undefined
		? [f.spec]
		: []
);

export function dialectOf(field: Formatted): MarkdownDialect | null {
	if (field.dialect !== undefined) return field.dialect;
	const kind =
		field.spec === undefined ? undefined : fieldSpec(field.spec.level, field.spec.path)?.markdown;
	if (kind === 'always') return ALWAYS_MARKDOWN;
	if (kind === 'sniffed') return SNIFFED;
	return null;
}

function rule(field: Formatted): string {
	const dialect = dialectOf(field);
	if (dialect === null)
		return `- ${field.key} (${field.what}): plain text. No $ signs, no LaTeX, no Markdown (no **, no lists, no backticks); write fractions and powers as typed text such as 21/30 or x^2. The app shows it as typed.`;
	if (dialect.inline)
		return `- ${field.key} (${field.what}): one short line. Inline Markdown only (**bold**, *italics*) and $…$ for maths; no line breaks, no lists, no headings.`;
	const shape = field.headings
		? 'Markdown (bold, lists, ## headings) and $…$ or $$…$$ for maths.'
		: 'inline Markdown (**bold**, *italics*, a short list) and $…$ for maths; no headings.';
	const drawn = dialect.sniffed
		? 'The app draws it as Markdown when it holds a Markdown character.'
		: 'The app always draws it as Markdown, so a stray * _ # or - at the start of a line changes how it looks.';
	return `- ${field.key} (${field.what}): ${shape} ${drawn}`;
}

/** The names of cards and lessons are not fields of the app's Markdown at all. */
const NAMES_RULE =
	'- Names of cards and lessons: plain text, no $ signs, no Markdown, no numbering.';

/** The lines both prompts carry. */
export function formatRules(options: { names?: boolean; fields?: boolean } = {}): string {
	const lines: string[] = [];
	if (options.fields !== false) lines.push(...FORMATTED.map(rule));
	if (options.names !== false) lines.push(NAMES_RULE);
	return lines.join('\n');
}
