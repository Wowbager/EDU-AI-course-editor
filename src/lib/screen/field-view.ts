/**
 * One field as the teacher sees it: what a settings dialog, a step's extras or a card's
 * header draws for a `FieldSpec`. `FieldGroup` renders these and decides nothing — the
 * text in the box, the line it says when empty, the hint, the options, the draft that is
 * not a number yet and the line under it are all here.
 *
 * Mode and Zpětná vazba decide which specs are listed (`fieldsFor`), never the
 * component; a field the mode does not show is not in the list, and
 * `hiddenFields` says which those are and in which mode they appear.
 */
import { formatDateTimeCs } from '$lib/domain/format-date';
import { notANumberMessage } from '$lib/domain/number-input';
import { refKey, type Ref } from '$lib/domain/ref';
import {
	FIELDS,
	MODE_LABELS,
	hintFor,
	visible,
	type FieldKind,
	type FieldLevel,
	type FieldSpec,
	type Mode
} from '$lib/ui/fields';
import type { FieldHidden, FieldView } from './types';

/** A value read off a node by a dotted path (`question.options`), or undefined. */
export function readPath(node: unknown, path: string): unknown {
	return path
		.split('.')
		.reduce<unknown>(
			(at, key) =>
				at === undefined || at === null ? undefined : (at as Record<string, unknown>)[key],
			node
		);
}

/** What goes in a text box for a value: nothing for no value, the number as it is written. */
export function asText(value: unknown): string {
	return value === undefined || value === null ? '' : String(value);
}

/** The line an empty field says: its default, or that nothing is filled in. */
export const emptyTextOf = (spec: Pick<FieldSpec, 'default'>): string =>
	spec.default === undefined ? 'nevyplněno' : `výchozí ${spec.default}`;

/**
 * The ref a spec of `level` writes to, for the node it is read from: how an issue, a
 * draft and "this field was left" are keyed. A question's fields are the step's, under
 * `question.`.
 */
export function refOfField(level: FieldLevel, scope: Ref, path: string): Ref {
	const field = level === 'question' ? `question.${path}` : path;
	switch (level) {
		case 'course':
			return { field };
		case 'lesson':
			return { lessonId: scope.lessonId, field };
		case 'binding':
			return { lessonId: scope.lessonId, blockId: scope.blockId, field };
		case 'block':
			return { blockId: scope.blockId, field };
		case 'step':
		case 'question':
			return { blockId: scope.blockId, stepId: scope.stepId, field };
		case 'option':
			return { blockId: scope.blockId, stepId: scope.stepId, optionId: scope.optionId, field };
	}
}

export interface FieldContext {
	/** The node the spec's path is read from (the course, a lesson, a block, a step…). */
	root: unknown;
	/** The ids of that node, to key drafts and issue markers. */
	scope: Ref;
	drafts: Readonly<Record<string, string>>;
	/** Reads a path that is not on `root` as it is stored (practice, for one). */
	override?: (path: string) => unknown | undefined;
}

/**
 * The options a select draws. A segmented one drops the number in front of a label
 * ("3 – splňuje"), which its own order already shows; a value the list does not have
 * (an import) stays visible as it is instead of being lost.
 */
function optionsOf(spec: FieldSpec, current: string): { value: string; label: string }[] | null {
	if (spec.options === undefined) return null;
	const own = spec.options.map((o) => ({
		value: o.value,
		label: spec.display === 'segmented' ? o.label.replace(/^\d+ – /, '') : o.label
	}));
	return current !== '' && !own.some((o) => o.value === current)
		? [...own, { value: current, label: current }]
		: own;
}

export function fieldView(spec: FieldSpec, context: FieldContext): FieldView {
	const stored = context.override?.(spec.path);
	const raw = stored !== undefined ? stored : readPath(context.root, spec.path);
	const ref = refOfField(spec.level, context.scope, spec.path);
	const draft = spec.kind === 'number' ? context.drafts[refKey(ref)] : undefined;
	// A timestamp is read in Czech form, and "—" stands where there is none.
	const text =
		spec.display === 'datetime'
			? asText(raw) !== ''
				? formatDateTimeCs(asText(raw))
				: '—'
			: asText(raw);
	return {
		key: `${spec.level}.${spec.path}`,
		level: spec.level,
		path: spec.path,
		label: spec.label,
		hint: hintFor(spec) ?? null,
		kind: spec.kind as FieldKind,
		display: spec.display ?? null,
		value: spec.kind === 'toggle' ? '' : text,
		checked: spec.kind === 'toggle' ? raw === true : null,
		empty_text: emptyTextOf(spec),
		options: optionsOf(spec, text),
		numeric: spec.numeric === true,
		draft: draft ?? null,
		error: draft === undefined ? null : notANumberMessage(draft),
		min: spec.min ?? null,
		max: spec.max ?? null,
		disabled: false,
		ref
	};
}

export const fieldViews = (specs: readonly FieldSpec[], context: FieldContext): FieldView[] =>
	specs.map((spec) => fieldView(spec, context));

/**
 * What the mode keeps off the screen at `level`s: the fields that exist, with the mode
 * that shows them. An AI is told these as hidden rather than not at all, so it does not
 * mistake a field the teacher cannot see for one that does not exist.
 */
export function hiddenFields(
	levels: readonly FieldLevel[],
	mode: Mode,
	feedback: boolean
): FieldHidden[] {
	return FIELDS.filter((spec) => levels.includes(spec.level) && !visible(spec, mode, feedback)).map(
		(spec) => ({
			key: `${spec.level}.${spec.path}`,
			label: spec.label,
			// Off for Zpětná vazba, not for the mode: it shows once the toggle is on.
			hidden_in_mode: visible(spec, mode, true) ? null : MODE_LABELS[spec.mode].label,
			hidden_by_feedback: visible(spec, mode, true)
		})
	);
}
