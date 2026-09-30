/**
 * Question cards: what a teacher edits as one card is, in the document, one block per
 * question.
 *
 * The app treats a block as one graded item: one score (the best over its questions,
 * `block_step_engine.dart` `_bestScoreKoef`), one mark (the last one given), one
 * practice card, one ELO update, one entry in Kvíz. A block with two questions is
 * graded as if it had one. So the document keeps every question in its own block, and
 * the blocks that one teacher's card became carry the same `group` key. A card whose
 * questions really belong together (a retry that branches inside the card) is marked
 * `multi_question: true` by the advanced author and stays one block.
 *
 * The teacher never sees the split. `toView` merges a group back into one card for the
 * Učitel and Metodik modes, and `fromView` writes an edit of that card back into the
 * group. The document is always what gets exported (AGENTS.md rule 6); the view is
 * derived and never stored.
 *
 * The two directions are a lens, and its laws are what the tests hold:
 *
 *  - an edit that changes nothing changes nothing: `fromView(doc, v, v) === doc`;
 *  - the view of what was written is what was edited, up to renumbering;
 *  - a card nobody touched keeps its blocks as they were, object for object.
 */
import type { BlockStep, BlockV2, CourseV2, LessonBlockBinding, LessonV2 } from './schema';
import { isGoToKeyword, MEMBERS_KEY } from './index-doc';
import type { Reservations } from './ids';

/** The key the blocks of one teacher's card share. Its value is the card's id. */
export const GROUP_KEY = 'group';
/** Set by the advanced author: this block's questions are one graded item on purpose. */
export const TOGETHER_KEY = 'multi_question';
export { MEMBERS_KEY };

type Loose = Record<string, unknown>;

/**
 * Block fields that belong to one block rather than to the card. Everything else a
 * card has — its name, skills, hint, practice settings, and keys this editor does not
 * model — is the card's, and is written to every block of the group.
 *
 *  - `duration` and an authored `xp` are kept on the first block only, because a
 *    lesson's length and reward are sums over its blocks, and copying them would
 *    multiply the card's.
 */
const OWN_FIELDS = new Set(['block_id', 'type', 'steps', GROUP_KEY, MEMBERS_KEY]);
const FIRST_ONLY = new Set(['duration', 'xp']);

export const groupOf = (block: BlockV2): string | undefined => {
	const value = (block as Loose)[GROUP_KEY];
	return typeof value === 'string' && value !== '' ? value : undefined;
};

export const keepsQuestionsTogether = (block: BlockV2): boolean =>
	(block as Loose)[TOGETHER_KEY] === true;

export const membersOf = (block: BlockV2): string[] | undefined => {
	const value = (block as Loose)[MEMBERS_KEY];
	return Array.isArray(value) ? (value as string[]) : undefined;
};

const isQuestion = (step: BlockStep) => step.type === 'question';

export const questionCount = (block: BlockV2): number => block.steps.filter(isQuestion).length;

/** Whether the app would grade this block's questions as one item. */
export const gradesQuestionsTogether = (block: BlockV2): boolean => questionCount(block) > 1;

/** The groups of a document: key → its blocks, in document order. */
export function groupsOf(doc: CourseV2): Map<string, BlockV2[]> {
	const groups = new Map<string, BlockV2[]>();
	for (const block of doc.blocks) {
		const key = groupOf(block);
		if (key === undefined) continue;
		groups.set(key, [...(groups.get(key) ?? []), block]);
	}
	return groups;
}

// ───────────────────────────────────── the view ─────────────────────────────────────

/**
 * The document as the Učitel and Metodik modes show it: each group as one card.
 * Returns `doc` itself when there are no groups, so the common case costs nothing.
 */
export function toView(doc: CourseV2): CourseV2 {
	const groups = groupsOf(doc);
	if (groups.size === 0) return doc;

	/** Which card a member block is in, and where its steps start in that card. */
	const cardOf = new Map<string, { key: string; firstStep?: string; first: boolean }>();
	for (const [key, members] of groups) {
		members.forEach((member, i) =>
			cardOf.set(member.block_id, { key, firstStep: member.steps[0]?.id, first: i === 0 })
		);
	}

	/** A `go_to` or prerequisite value, as the view writes it from inside `fromKey`. */
	const target = (value: string, fromKey: string | undefined): string => {
		const card = cardOf.get(value);
		if (card === undefined) return value;
		// A jump to another block of the same card is a jump to a step of it.
		if (card.key === fromKey && card.firstStep !== undefined) return card.firstStep;
		// Into another card: its first block is the card; a later one stays itself,
		// and resolves through the card's members.
		return card.first ? card.key : value;
	};

	const blocks: BlockV2[] = [];
	for (const block of doc.blocks) {
		const key = groupOf(block);
		if (key === undefined) {
			blocks.push(retarget(block, (v) => target(v, undefined)));
			continue;
		}
		const members = groups.get(key)!;
		if (members[0] !== block) continue;
		blocks.push(
			mergeGroup(
				key,
				members,
				(v) => target(v, key),
				(v) => target(v, undefined)
			)
		);
	}

	const lessons = doc.lessons.map((lesson) => collapseBindings(lesson, cardOf));
	return { ...doc, blocks, lessons };
}

function mergeGroup(
	key: string,
	members: BlockV2[],
	target: (v: string) => string,
	prerequisite: (v: string) => string
): BlockV2 {
	const first = members[0];
	const card: Loose = {};
	for (const [field, value] of Object.entries(first)) {
		if (field === GROUP_KEY) continue;
		card[field] = value;
	}
	const graded = members.find((m) => m.type !== 'display');
	card.block_id = key;
	card.type = (graded ?? first).type;
	card.steps = members.flatMap((m) => m.steps).map((step) => retargetStep(step, target));
	card[MEMBERS_KEY] = members.map((m) => m.block_id);
	return retargetPrerequisites(card as BlockV2, prerequisite);
}

function collapseBindings(lesson: LessonV2, cardOf: Map<string, { key: string }>): LessonV2 {
	let changed = false;
	const seen = new Set<string>();
	const bindings: LessonBlockBinding[] = [];
	for (const binding of lesson.blocks) {
		const card = cardOf.get(binding.block_id);
		if (card === undefined) {
			bindings.push(binding);
			continue;
		}
		changed = true;
		if (seen.has(card.key)) continue;
		seen.add(card.key);
		bindings.push({ ...binding, block_id: card.key });
	}
	return changed ? { ...lesson, blocks: renumber(bindings, lesson.blocks) } : lesson;
}

/** Renumber `order` 1…n, but only where the originals carried one. */
function renumber<T extends { order?: number }>(items: T[], originals: readonly T[]): T[] {
	if (!originals.some((item) => item.order !== undefined)) return items;
	return items.map((item, i) => (item.order === i + 1 ? item : { ...item, order: i + 1 }));
}

// ─────────────────────────────── references inside blocks ───────────────────────────────

function retargetStep(step: BlockStep, target: (v: string) => string): BlockStep {
	const options = step.question?.options;
	if (options === undefined) return step;
	let changed = false;
	const next = options.map((option) => {
		const value = option.go_to;
		if (typeof value !== 'string' || value === '' || isGoToKeyword(value)) return option;
		const to = target(value);
		if (to === value) return option;
		changed = true;
		return { ...option, go_to: to };
	});
	return changed ? { ...step, question: { ...step.question!, options: next } } : step;
}

/** Rewrite a block's `go_to` targets and prerequisite blocks. Unchanged → the same object. */
function retarget(block: BlockV2, target: (v: string) => string): BlockV2 {
	let changed = false;
	const steps = block.steps.map((step) => {
		const next = retargetStep(step, target);
		if (next !== step) changed = true;
		return next;
	});
	return retargetPrerequisites(changed ? { ...block, steps } : block, target);
}

function retargetPrerequisites(block: BlockV2, target: (v: string) => string): BlockV2 {
	const rules = block.learning?.prerequisites;
	if (rules === undefined) return block;
	let changed = false;
	const next = rules.map((rule) => {
		if (typeof rule.block_id !== 'string' || rule.block_id === '') return rule;
		const to = target(rule.block_id);
		if (to === rule.block_id) return rule;
		changed = true;
		return { ...rule, block_id: to };
	});
	return changed ? { ...block, learning: { ...block.learning!, prerequisites: next } } : block;
}

// ───────────────────────────────────── splitting ─────────────────────────────────────

/**
 * Where a card's steps break into blocks. Each block is the text and media before a
 * question, then the question. Text after the last question stays with it.
 *
 * In a `question` card a step something jumps to also starts a block, because a
 * branch into another block always lands on that block's first step. A stretch with
 * no question becomes a `display` block. `exercise` cards ignore `go_to` in the app,
 * so their jumps break nothing.
 */
export function segmentSteps(card: BlockV2): BlockStep[][] {
	const targets = new Set<string>();
	if (card.type === 'question') {
		const ids = new Set(card.steps.map((s) => s.id));
		for (const step of card.steps) {
			for (const option of step.question?.options ?? []) {
				if (typeof option.go_to === 'string' && ids.has(option.go_to)) targets.add(option.go_to);
			}
		}
	}

	const segments: BlockStep[][] = [];
	let current: BlockStep[] = [];
	let closed = false;
	const questionsAfter = (i: number) => card.steps.slice(i).some(isQuestion);

	card.steps.forEach((step, i) => {
		const startsHere =
			current.length > 0 && ((closed && questionsAfter(i)) || targets.has(step.id));
		if (startsHere) {
			segments.push(current);
			current = [];
			closed = false;
		}
		current.push(step);
		if (isQuestion(step)) closed = true;
	});
	if (current.length > 0) segments.push(current);
	return segments;
}

/** Whether writing this card back splits it: it has two questions and is not kept whole. */
const splits = (card: BlockV2) => !keepsQuestionsTogether(card) && questionCount(card) > 1;

interface Written {
	/** The blocks the card became, in order. */
	blocks: BlockV2[];
	/** The card's key, when it is (still or now) a group. */
	key?: string;
}

/**
 * Write one card of the view back as blocks. `previous` are the blocks it stood for
 * before the edit; a block keeps its id as long as its question does, so a pupil's
 * saved answers stay with the question they belong to.
 */
function writeCard(card: BlockV2, previous: BlockV2[], takenIds: Set<string>): Written {
	const wasGroup = previous.length > 0 && groupOf(previous[0]) !== undefined;
	const key = wasGroup ? groupOf(previous[0])! : card.block_id;

	if (!wasGroup && !splits(card)) {
		return { blocks: [stripView(card)] };
	}

	const segments = keepsQuestionsTogether(card) ? [card.steps] : segmentSteps(card);
	const used = new Set<string>();
	const idFor = (segment: BlockStep[], i: number): string => {
		const anchor = segment.find(isQuestion) ?? segment[0];
		const owner = previous.find(
			(block) => !used.has(block.block_id) && block.steps.some((s) => s.id === anchor?.id)
		);
		if (owner !== undefined) return owner.block_id;
		// The card's own id goes to its first block when nothing claims it yet.
		if (i === 0 && !used.has(key) && !previous.some((b) => b.block_id === key)) {
			if (!takenIds.has(key) || previous.length === 0) return key;
		}
		let n = 2;
		while (takenIds.has(`${key}_${n}`) || used.has(`${key}_${n}`)) n++;
		return `${key}_${n}`;
	};

	const ids = segments.map((segment, i) => {
		const id = idFor(segment, i);
		used.add(id);
		takenIds.add(id);
		return id;
	});
	const home = new Map<string, string>();
	segments.forEach((segment, i) => segment.forEach((step) => home.set(step.id, ids[i])));

	const blocks = segments.map((segment, i): BlockV2 => {
		const own = new Set(segment.map((s) => s.id));
		const steps = renumber(
			segment.map((step) =>
				retargetStep(step, (value) => (own.has(value) ? value : (home.get(value) ?? value)))
			),
			segment
		);
		const block: Loose = {};
		for (const [field, value] of Object.entries(card)) {
			if (OWN_FIELDS.has(field)) continue;
			if (FIRST_ONLY.has(field) && i > 0) continue;
			block[field] = value;
		}
		block.block_id = ids[i];
		block.type = segment.some(isQuestion) ? card.type : 'display';
		block[GROUP_KEY] = key;
		block.steps = steps;
		const before = previous.find((b) => b.block_id === ids[i]);
		return before !== undefined && sameBlock(before, block as BlockV2)
			? before
			: (block as BlockV2);
	});
	return { blocks, key };
}

function stripView(card: BlockV2): BlockV2 {
	if (!(MEMBERS_KEY in card)) return card;
	const { [MEMBERS_KEY]: _members, ...rest } = card as Loose;
	return rest as BlockV2;
}

/** Deep equality regardless of key order (`serialise` puts the keys in order). */
const sameBlock = (a: BlockV2, b: BlockV2) => canonical(a) === canonical(b);

function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, v) =>
		v !== null && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v as Loose).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				)
			: v
	);
}

// ───────────────────────────────────── writing back ─────────────────────────────────────

/**
 * Write an edit of the view back into the document.
 *
 * `base` is the view the edit started from (`toView(doc)`), `edited` what the command
 * made of it. Only what differs between the two is written: a card that did not
 * change keeps its blocks, a lesson that did not change keeps its bindings, and an
 * edit that changed nothing returns `doc` itself.
 */
export function fromView(
	doc: CourseV2,
	base: CourseV2,
	edited: CourseV2,
	reserved?: Reservations
): CourseV2 {
	if (edited === base) return doc;
	// No groups before and none needed now: the view was the document.
	if (base === doc && !edited.blocks.some(splits)) return edited;

	const groups = groupsOf(doc);
	const baseCards = new Map(base.blocks.map((b) => [b.block_id, b]));
	/** The blocks each card of the view stood for. */
	const previousOf = (card: BlockV2): BlockV2[] => {
		const key = card.block_id;
		const members = groups.get(key);
		if (members !== undefined) return members;
		const own = doc.blocks.find((b) => b.block_id === key && groupOf(b) === undefined);
		return own !== undefined ? [own] : [];
	};

	const takenIds = new Set<string>([
		...doc.blocks.map((b) => b.block_id),
		...edited.blocks.map((b) => b.block_id),
		...groups.keys(),
		...(reserved?.blocks ?? [])
	]);

	/** Card key → the blocks written for it. */
	const written = new Map<string, BlockV2[]>();
	let blocks: BlockV2[] = [];
	if (edited.blocks === base.blocks) {
		blocks = doc.blocks;
		for (const [key, members] of groups) written.set(key, members);
	} else {
		for (const card of edited.blocks) {
			const previous = previousOf(card);
			const unchanged = baseCards.get(card.block_id) === card;
			const out =
				unchanged && previous.length > 0
					? { blocks: previous }
					: writeCard(card, previous, takenIds);
			written.set(card.block_id, out.blocks);
			blocks.push(...out.blocks);
		}
	}

	// A card's id stands for its first block. Where that is no longer the block with
	// the card's id (its first question was deleted), point everything at the new one.
	const firstOf = new Map<string, string>();
	for (const [key, out] of written) {
		if (out.length > 0 && out[0].block_id !== key && groupOf(out[0]) === key)
			firstOf.set(key, out[0].block_id);
	}
	const ids = new Set(blocks.map((b) => b.block_id));
	const outward = (value: string) =>
		!ids.has(value) && firstOf.has(value) ? firstOf.get(value)! : value;
	// Untouched blocks were already pointed at the right block when that changed.
	const finalBlocks =
		firstOf.size === 0 || blocks === doc.blocks ? blocks : blocks.map((b) => retarget(b, outward));

	// A lesson the edit did not touch still changes when a card it binds gained or
	// lost a block, so each is expanded and kept only if that changed nothing.
	const lessons =
		edited.lessons === base.lessons && edited.blocks === base.blocks
			? doc.lessons
			: edited.lessons.map((lesson) => {
					const before = base.lessons.find((l) => l.lesson_id === lesson.lesson_id);
					const source = doc.lessons.find((l) => l.lesson_id === lesson.lesson_id);
					const expanded = expandBindings(lesson, source, written);
					if (
						before === lesson &&
						source !== undefined &&
						sameIds(source.blocks, expanded.blocks)
					) {
						return source;
					}
					return expanded;
				});

	const course: Loose = {};
	for (const [field, value] of Object.entries(edited)) {
		if (field === 'blocks') course.blocks = finalBlocks;
		else if (field === 'lessons') course.lessons = lessons;
		else course[field] = base[field as keyof CourseV2] === value ? (doc as Loose)[field] : value;
	}
	return course as CourseV2;
}

/** A lesson of the view, with each card's binding expanded to its blocks. */
function expandBindings(
	lesson: LessonV2,
	source: LessonV2 | undefined,
	written: Map<string, BlockV2[]>
): LessonV2 {
	const bindings: LessonBlockBinding[] = [];
	for (const binding of lesson.blocks) {
		const members = written.get(binding.block_id);
		if (members === undefined || members.length === 0) {
			bindings.push(binding);
			continue;
		}
		for (const member of members) {
			const own = source?.blocks.find((b) => b.block_id === member.block_id);
			const { order: _order, block_id: _id, ...fields } = binding;
			bindings.push(
				own !== undefined && sameFields(own, fields)
					? own
					: { ...own, ...fields, block_id: member.block_id }
			);
		}
	}
	const expanded = renumber(bindings, lesson.blocks);
	if (source !== undefined && sameBindings(source.blocks, expanded))
		return { ...lesson, blocks: source.blocks };
	return { ...lesson, blocks: expanded };
}

const sameFields = (binding: LessonBlockBinding, fields: Loose) =>
	Object.entries(fields).every(
		([k, v]) => JSON.stringify((binding as Loose)[k]) === JSON.stringify(v)
	);

const sameBindings = (a: readonly LessonBlockBinding[], b: readonly LessonBlockBinding[]) =>
	canonical(a) === canonical(b);

const sameIds = (a: readonly LessonBlockBinding[], b: readonly LessonBlockBinding[]) =>
	a.length === b.length && a.every((binding, i) => binding.block_id === b[i].block_id);

// ─────────────────────────────── the rest of the document ───────────────────────────────

/**
 * Split every block with two or more questions into a group, as the teacher's view
 * would have written it. Run on an import and on a restored draft, so a course that
 * came from elsewhere plays each question as its own card too.
 *
 * A block that branches to one of its own steps is marked `multi_question` instead of
 * split: a jump into another block starts that block at its first step, and the
 * blocks it skips stay in the pupil's lesson drawn unfinished, so splitting would
 * change the flow the author built.
 */
export function splitQuestionCards(
	doc: CourseV2,
	reserved?: Reservations
): { doc: CourseV2; split: string[]; keptTogether: string[] } {
	const split: string[] = [];
	const keptTogether: string[] = [];
	const candidates = doc.blocks.filter(
		(b) => groupOf(b) === undefined && !keepsQuestionsTogether(b) && questionCount(b) > 1
	);
	if (candidates.length === 0) return { doc, split, keptTogether };

	const marked = doc.blocks.map((block) => {
		if (!candidates.includes(block)) return block;
		if (block.type === 'question' && branchesInside(block)) {
			keptTogether.push(block.block_id);
			return { ...block, [TOGETHER_KEY]: true } as BlockV2;
		}
		split.push(block.block_id);
		return block;
	});
	const base = { ...doc, blocks: marked };
	if (split.length === 0) return { doc: base, split, keptTogether };
	// Writing the unchanged view back splits exactly the blocks that need it.
	const view = toView(base);
	// A card counts as edited only when it is a new object, so the ones to split are.
	const edited = {
		...view,
		blocks: view.blocks.map((b) => (split.includes(b.block_id) ? { ...b } : b))
	};
	return { doc: fromView(base, view, edited, reserved), split, keptTogether };
}

/**
 * Whether the block's flow depends on its questions being one block: an answer jumps
 * to one of the block's own steps, or ends the block (`END`) before its last
 * question — split, that would end only its own question.
 */
export function branchesInside(block: BlockV2): boolean {
	const ids = new Set(block.steps.map((s) => s.id));
	const last = block.steps.filter(isQuestion).at(-1);
	return block.steps.some((step) =>
		(step.question?.options ?? []).some(
			(o) =>
				typeof o.go_to === 'string' && (ids.has(o.go_to) || (o.go_to === 'END' && step !== last))
		)
	);
}

/**
 * Merge a group into one block that keeps its questions together (the advanced
 * toggle). The block keeps the group's key as its id when that is still free, so
 * what pointed at the card still does.
 */
export function mergeQuestionCard(doc: CourseV2, key: string): CourseV2 {
	const members = groupsOf(doc).get(key);
	if (members === undefined) return doc;
	const view = toView(doc);
	const card = view.blocks.find((b) => b.block_id === key);
	if (card === undefined) return doc;
	const whole = { ...stripView(card), [TOGETHER_KEY]: true } as BlockV2;
	const firstId = members[0].block_id;
	const id =
		members.some((m) => m.block_id === key) || !doc.blocks.some((b) => b.block_id === key)
			? key
			: firstId;
	const merged = { ...whole, block_id: id, steps: renumber(whole.steps, whole.steps) } as BlockV2;
	const memberIds = new Set(members.map((m) => m.block_id));
	const pointsHere = (value: string) => (memberIds.has(value) ? id : value);
	const blocks: BlockV2[] = [];
	for (const block of doc.blocks) {
		if (block === members[0]) blocks.push(merged);
		else if (!memberIds.has(block.block_id)) blocks.push(retarget(block, pointsHere));
	}
	const lessons = doc.lessons.map((lesson) => {
		if (!lesson.blocks.some((b) => memberIds.has(b.block_id))) return lesson;
		const seen = new Set<string>();
		const bindings = lesson.blocks.flatMap((b) => {
			if (!memberIds.has(b.block_id)) return [b];
			if (seen.has('card')) return [];
			seen.add('card');
			return [{ ...b, block_id: id }];
		});
		return { ...lesson, blocks: renumber(bindings, lesson.blocks) };
	});
	return { ...doc, blocks, lessons };
}

/**
 * After an edit made on the document itself (the advanced mode edits it directly),
 * write every card the edit touched back through the view, so a question added to a
 * block becomes its own block there too. Blocks kept together are left whole.
 * Untouched cards are not looked at.
 */
export function resplitChanged(
	before: CourseV2,
	after: CourseV2,
	reserved?: Reservations
): CourseV2 {
	if (after === before || after.blocks === before.blocks) return after;
	const old = new Set(before.blocks);
	const touched = new Set<string>();
	for (const block of after.blocks) {
		if (old.has(block)) continue;
		touched.add(groupOf(block) ?? block.block_id);
	}
	if (touched.size === 0) return after;
	const view = toView(after);
	const needs = view.blocks.some(
		(card) => touched.has(card.block_id) && (membersOf(card) !== undefined || splits(card))
	);
	if (!needs) return after;
	const edited = {
		...view,
		blocks: view.blocks.map((card) => (touched.has(card.block_id) ? { ...card } : card))
	};
	return fromView(after, view, edited, reserved);
}

/** The advanced toggle's other way: split a block kept together into its group. */
export function splitQuestionCard(
	doc: CourseV2,
	blockId: string,
	reserved?: Reservations
): CourseV2 {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	if (block === undefined || !keepsQuestionsTogether(block)) return doc;
	const { [TOGETHER_KEY]: _together, ...rest } = block as Loose;
	const base = { ...doc, blocks: doc.blocks.map((b) => (b === block ? (rest as BlockV2) : b)) };
	const view = toView(base);
	const edited = {
		...view,
		blocks: view.blocks.map((b) => (b.block_id === blockId ? { ...b } : b))
	};
	return fromView(base, view, edited, reserved);
}

// ───────────────────────────────────── refs ─────────────────────────────────────

/** The card a real block belongs to, in the view. */
export function cardIdOf(doc: CourseV2, blockId: string): string {
	const block = doc.blocks.find((b) => b.block_id === blockId);
	return (block && groupOf(block)) ?? blockId;
}

/**
 * The real block that holds `stepId` of the card `cardId`. Step ids are unique within
 * a card, so the step says which of its blocks is meant.
 */
export function blockOfStep(doc: CourseV2, cardId: string, stepId: string | undefined): string {
	const members = groupsOf(doc).get(cardId);
	if (members === undefined) return cardId;
	if (stepId === undefined) return members[0].block_id;
	return (members.find((m) => m.steps.some((s) => s.id === stepId)) ?? members[0]).block_id;
}
