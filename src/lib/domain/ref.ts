/**
 * `Ref` is the universal address of a place in the document. Selection, validation
 * results, preview click-to-edit, deep links and jump-to-fix all speak it.
 *
 * Every part is optional because issues exist at every level, including the course
 * itself (`{}` addresses the course root — e.g. "version not bumped").
 *
 * Disambiguation rule: a Ref carrying `stepId` or `optionId` addresses the block
 * definition (steps live on blocks, not on bindings), and `lessonId` is then only
 * UI context — which lesson the author was looking at. A Ref with `lessonId` and
 * `blockId` but no `stepId` addresses the lesson↔block *binding*.
 */
export interface Ref {
	lessonId?: string;
	blockId?: string;
	stepId?: string;
	optionId?: string;
	field?: string;
}

const seg = (key: string, value: string) => `${key}=${escapeValue(value)}`;
// Both brackets are escaped, not just the closing one: an unescaped `[` inside a
// value would otherwise unbalance the predicate when the path is split back up.
const escapeValue = (v: string) => v.replace(/\\/g, '\\\\').replace(/([[\]])/g, '\\$1');
const unescapeValue = (v: string) =>
	v.replace(/\\([[\]])/g, '$1').replace(/\\\\/g, '\\');

/**
 * Serialise a Ref to a key-predicate JSON path, e.g.
 * `$.blocks[block_id=L1_B3].steps[id=s2].question.options[id=a].feedback`
 *
 * Predicates address by business key rather than array index, so a path stays
 * valid across a reorder — which is what makes it usable in a deep link.
 */
export function refToJsonPath(ref: Ref): string {
	const parts: string[] = ['$'];
	const addressesBlockBody = ref.stepId !== undefined || ref.optionId !== undefined;

	if (ref.lessonId !== undefined && !addressesBlockBody) {
		parts.push(`lessons[${seg('lesson_id', ref.lessonId)}]`);
		if (ref.blockId !== undefined) parts.push(`blocks[${seg('block_id', ref.blockId)}]`);
	} else if (ref.blockId !== undefined) {
		parts.push(`blocks[${seg('block_id', ref.blockId)}]`);
		if (ref.stepId !== undefined) parts.push(`steps[${seg('id', ref.stepId)}]`);
		if (ref.optionId !== undefined) parts.push(`question.options[${seg('id', ref.optionId)}]`);
	}

	let path = parts.join('.');
	if (ref.field !== undefined) path += `.${ref.field}`;
	return path;
}

const SEGMENT = /^(lessons|blocks|steps|question\.options)\[(lesson_id|block_id|id)=((?:[^\\\]]|\\.)*)\]$/;

/** Inverse of `refToJsonPath`. Throws on a path this module did not produce. */
export function jsonPathToRef(path: string): Ref {
	if (!path.startsWith('$')) throw new Error(`Not a ref path: ${path}`);
	const ref: Ref = {};
	// Split on dots that are not inside a [...] predicate.
	const segments = splitPath(path.slice(1));
	let sawLessonScope = false;

	for (const s of segments) {
		if (s === '') continue;
		const m = SEGMENT.exec(s);
		if (!m) {
			// A trailing plain segment is the field.
			if (/^[A-Za-z_][\w.]*$/.test(s)) {
				ref.field = ref.field === undefined ? s : `${ref.field}.${s}`;
				continue;
			}
			throw new Error(`Unparseable ref segment: ${s}`);
		}
		const [, collection, , rawValue] = m;
		const value = unescapeValue(rawValue);
		switch (collection) {
			case 'lessons':
				ref.lessonId = value;
				sawLessonScope = true;
				break;
			case 'blocks':
				ref.blockId = value;
				break;
			case 'steps':
				ref.stepId = value;
				break;
			case 'question.options':
				ref.optionId = value;
				break;
		}
	}
	void sawLessonScope;
	return ref;
}

function splitPath(path: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = '';
	for (let i = 0; i < path.length; i++) {
		const ch = path[i];
		if (ch === '\\') {
			current += ch + (path[++i] ?? '');
			continue;
		}
		if (ch === '[') depth++;
		if (ch === ']') depth--;
		if (ch === '.' && depth === 0) {
			// `question.options[...]` is one logical segment.
			if (current === 'question' && path.slice(i + 1).startsWith('options[')) {
				current += ch;
				continue;
			}
			out.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	out.push(current);
	return out;
}

export function refEquals(a: Ref, b: Ref): boolean {
	return (
		a.lessonId === b.lessonId &&
		a.blockId === b.blockId &&
		a.stepId === b.stepId &&
		a.optionId === b.optionId &&
		a.field === b.field
	);
}

/** Stable string key for maps and Svelte `{#each}` keys. */
export const refKey = (ref: Ref): string => refToJsonPath(ref);
