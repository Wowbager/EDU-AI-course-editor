/**
 * The course dossier: the plain text the AI reads before the request for one card.
 *
 * It works on the view document (`store.doc`), where the blocks of one teacher card are
 * already merged, so one view card is one card here. It leaves out everything a model
 * must not echo or cannot use: ids, URLs and the app's own settings (xp, fsrs, gpf,
 * status, ...). The output is deterministic: the same document gives the same string,
 * which the provider's prefix cache relies on.
 */
import { AUDIENCE_KEY, BRIEF_KEY } from './authoring';
import type { BlockStep, BlockV2, CourseV2, LessonV2, QuestionConfig } from './schema';

export const DOSSIER_BUDGET_TOKENS = 150_000;

/** Tokens as the plan estimates them: 3 characters each. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

export const MARKER_OPEN = '>>> TATO KARTA (píšeš ji) >>>';
export const MARKER_CLOSE = '<<< TATO KARTA <<<';
export const TRUNCATED_NOTE = '[…zkráceno…]';

const NAME_MAX = 70;
const FIRST_LINE_MAX = 120;

const KIND_LABEL: Record<string, string> = {
	display: 'Výklad',
	question: 'Otázka',
	exercise: 'Cvičení'
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Markdown with the links and pictures made safe: no URL survives. */
function clean(value: unknown): string {
	return text(value)
		.replace(/!\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, (_, alt: string) =>
			alt.trim() === '' ? '[obrázek]' : `[obrázek: ${alt.trim()}]`
		)
		.replace(/\[((?:[^[\]]|\[[^[\]]*\])*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
		.replace(
			/(?:https?:\/\/|data:|mailto:|javascript:)[^\s()<>[\]]*[^\s()<>[\].,;:!?]/gi,
			'[odkaz]'
		);
}

const firstLine = (value: string, max: number): string => {
	const line = value.split('\n').find((l) => l.trim() !== '') ?? '';
	const trimmed = line.trim();
	return trimmed.length > max ? trimmed.slice(0, max).trimEnd() + '…' : trimmed;
};

/** The card's first non-empty line of text, or ''. */
function firstText(block: BlockV2): string {
	for (const step of block.steps) {
		const line = firstLine(clean(step.content), FIRST_LINE_MAX);
		if (line !== '') return line;
	}
	return '';
}

/** Name for the outline: its own, else the first text line; '' for a truly empty card. */
function titleOf(block: BlockV2): string {
	const own = firstLine(clean(block.name), NAME_MAX);
	if (own !== '') return own;
	for (const step of block.steps) {
		const line = firstLine(clean(step.content), NAME_MAX);
		if (line !== '') return line;
	}
	return '';
}

const kindOf = (block: BlockV2): string => KIND_LABEL[block.type] ?? 'Karta';

// ───────────────────────────────── cards in full ─────────────────────────────────

function mediaLine(step: BlockStep): string | undefined {
	if (step.type === 'image') {
		const alt = text(step.image?.alt);
		return alt === '' ? '[obrázek]' : `[obrázek: ${alt}]`;
	}
	if (step.type === 'video') return '[video]';
	if (step.type === 'audio') return '[zvuk]';
	return undefined;
}

function questionLines(q: QuestionConfig): string[] {
	const out: string[] = [];
	const options = q.options ?? [];
	switch (q.type) {
		case 'multiple_choice':
			out.push(
				q.allow_multiple === true
					? 'Typ: výběr z možností, více správných'
					: 'Typ: výběr z možností, jedna správná'
			);
			break;
		case 'true_false':
			out.push('Typ: ano / ne');
			break;
		case 'numeric': {
			out.push('Typ: číselná odpověď');
			if (typeof q.correct_number === 'number') {
				const tol =
					typeof q.tolerance === 'number' && q.tolerance > 0 ? ` (tolerance ${q.tolerance})` : '';
				out.push(`Správná odpověď: ${q.correct_number}${tol}`);
			}
			break;
		}
		default:
			out.push('Typ: otevřená odpověď');
			if (text(q.correct_answer) !== '') out.push(`Vzorová odpověď: ${clean(q.correct_answer)}`);
	}
	for (const o of options) {
		if (text(o.text) === '') continue;
		const feedback = text(o.feedback) === '' ? '' : ` — reakce: ${clean(o.feedback)}`;
		out.push(`- [${o.is_correct === true ? '✓' : ' '}] ${clean(o.text)}${feedback}`);
	}
	return out;
}

function stepLines(step: BlockStep): string[] {
	const out: string[] = [];
	const media = mediaLine(step);
	if (media !== undefined) out.push(media);
	if (text(step.content) !== '') out.push(clean(step.content));
	if (step.type === 'question' && step.question !== undefined) {
		out.push(...questionLines(step.question));
		if (text(step.question.solution) !== '') out.push(`Řešení: ${clean(step.question.solution)}`);
		if (step.question.solution_image !== undefined) out.push('[obrázek]');
	}
	if (text(step.hint) !== '') out.push(`Nápověda: ${clean(step.hint)}`);
	if (text(step.help) !== '') out.push(`Pomoc: ${clean(step.help)}`);
	return out;
}

/** Whether the card says anything at all. */
const isEmptyCard = (block: BlockV2): boolean =>
	titleOf(block) === '' &&
	text(block.hint) === '' &&
	text(block.help) === '' &&
	text((block as Record<string, unknown>)[BRIEF_KEY]) === '' &&
	block.steps.every((s) => stepLines(s).length === 0);

function cardInFull(block: BlockV2, current: boolean): string {
	const name = firstLine(clean(block.name), NAME_MAX);
	const lines: string[] = [`### ${kindOf(block)}${name === '' ? '' : `: ${name}`}`];
	const brief = clean((block as Record<string, unknown>)[BRIEF_KEY]);
	if (brief !== '') lines.push(`Záměr karty: ${brief}`);
	let n = 0;
	for (const step of block.steps) {
		const body = stepLines(step);
		if (body.length === 0) continue;
		n++;
		lines.push(`Krok ${n}:`, ...body);
	}
	if (text(block.hint) !== '') lines.push(`Nápověda ke kartě: ${clean(block.hint)}`);
	if (text(block.help) !== '') lines.push(`Pomoc ke kartě: ${clean(block.help)}`);
	if (current && lines.length === 1) lines.push('(zatím prázdná)');
	const body = lines.join('\n');
	return current ? `${MARKER_OPEN}\n${body}\n${MARKER_CLOSE}` : body;
}

// ───────────────────────────────── lessons ─────────────────────────────────

type Level = 'full' | 'lines' | 'outline';

function cardsOf(doc: CourseV2, lesson: LessonV2): BlockV2[] {
	const byId = new Map(doc.blocks.map((b) => [b.block_id, b]));
	return lesson.blocks.flatMap((b) => byId.get(b.block_id) ?? []);
}

function lessonHead(lesson: LessonV2, index: number): string[] {
	const lines = [`## Lekce ${index + 1}: ${clean(lesson.name) || '(bez názvu)'}`];
	if (text(lesson.description) !== '') lines.push(`Co si žák odnese: ${clean(lesson.description)}`);
	if (text(lesson.ai_context) !== '') lines.push(`Poznámka pro AI: ${clean(lesson.ai_context)}`);
	return lines;
}

function renderLesson(
	doc: CourseV2,
	lesson: LessonV2,
	index: number,
	level: Level,
	currentId?: string
): string {
	const lines = lessonHead(lesson, index);
	const cards = cardsOf(doc, lesson);
	if (level === 'full') {
		for (const card of cards) {
			const current = card.block_id === currentId;
			if (!current && isEmptyCard(card)) continue;
			lines.push('', cardInFull(card, current));
		}
	} else {
		for (const card of cards) {
			if (isEmptyCard(card)) continue;
			const first = level === 'lines' ? firstText(card) : '';
			lines.push(
				`- ${kindOf(card)}: ${titleOf(card)}${first === '' || first === titleOf(card) ? '' : ` — ${first}`}`
			);
		}
	}
	return lines.join('\n');
}

function renderOutline(doc: CourseV2, upTo: number): string {
	const out: string[] = ['## Outline'];
	doc.lessons.slice(0, upTo).forEach((lesson, i) => {
		out.push('', ...lessonHead(lesson, i));
		for (const card of cardsOf(doc, lesson)) {
			const title = titleOf(card);
			if (title === '') continue;
			out.push(`- ${kindOf(card)}: ${title}`);
		}
	});
	if (upTo < doc.lessons.length) out.push('', TRUNCATED_NOTE);
	return out.join('\n');
}

function renderCourse(doc: CourseV2): string {
	const lines = ['## Course', `Název: ${clean(doc.name) || '(bez názvu)'}`];
	if (text(doc.description) !== '') lines.push(`Popis: ${clean(doc.description)}`);
	lines.push(`Jazyk: ${text(doc.language) || 'cs'}`);
	if (text(doc.ai_context) !== '') lines.push(`Poznámka pro AI: ${clean(doc.ai_context)}`);
	const audience = (doc as Record<string, unknown>)[AUDIENCE_KEY];
	if (typeof audience === 'object' && audience !== null) {
		const parts = Object.entries(audience as Record<string, unknown>)
			.filter(([, v]) => (typeof v === 'string' && v.trim() !== '') || typeof v === 'number')
			.map(([k, v]) => `${k}: ${clean(String(v))}`);
		if (parts.length > 0) lines.push(`Žáci (audience): ${parts.join('; ')}`);
	}
	return lines.join('\n');
}

// ───────────────────────────────── the dossier ─────────────────────────────────

/** Plain text the model reads before the card request. */
export function buildDossier(
	doc: CourseV2,
	cardId: string,
	lessonId?: string,
	budgetTokens: number = DOSSIER_BUDGET_TOKENS
): string {
	const budget = Math.max(0, budgetTokens) * 3;
	const course = renderCourse(doc);

	const exists = doc.blocks.some((b) => b.block_id === cardId);
	const lesson = exists
		? (doc.lessons.find(
				(l) => l.lesson_id === lessonId && l.blocks.some((b) => b.block_id === cardId)
			) ?? doc.lessons.find((l) => l.blocks.some((b) => b.block_id === cardId)))
		: undefined;
	const cur = lesson === undefined ? -1 : doc.lessons.indexOf(lesson);

	if (cur < 0) return [course, renderOutline(doc, doc.lessons.length)].join('\n\n') + '\n';

	// Earlier lessons start in full, later ones as first lines; shrinking only goes one way.
	const levels: Level[] = doc.lessons.map((_, i) => (i < cur ? 'full' : 'lines'));
	const parts = (outlineUpTo: number): { head: string; body: string } => {
		const head = [course, renderOutline(doc, outlineUpTo)].join('\n\n');
		const section = (title: string, from: number, to: number): string[] => {
			const items = doc.lessons
				.slice(from, to)
				.map((l, k) => renderLesson(doc, l, from + k, levels[from + k]));
			return items.length === 0 ? [] : [title, ...items];
		};
		const body = [
			...section('# Earlier lessons', 0, cur),
			'# Current lesson',
			renderLesson(doc, doc.lessons[cur], cur, 'full', cardId),
			...section('# Later lessons', cur + 1, doc.lessons.length)
		].join('\n\n');
		return { head, body };
	};
	const render = (upTo: number): string => {
		const { head, body } = parts(upTo);
		return `${head}\n\n${body}\n`;
	};

	// 1. Shrink the lessons farthest from the current one; before wins a tie.
	// The current lesson and the one just before it are never shrunk.
	const candidates = (): number[] =>
		doc.lessons
			.map((_, i) => i)
			.filter((i) => i !== cur && i !== cur - 1)
			.filter((i) => levels[i] !== (i < cur ? 'lines' : 'outline'))
			.sort((a, b) => Math.abs(b - cur) - Math.abs(a - cur) || a - b);
	let out = render(doc.lessons.length);
	while (out.length > budget) {
		const [next] = candidates();
		if (next === undefined) break;
		levels[next] = levels[next] === 'full' ? 'lines' : 'outline';
		out = render(doc.lessons.length);
	}
	if (out.length <= budget) return out;

	// 2. Drop the later lessons' entries from the outline, last first.
	let upTo = doc.lessons.length;
	while (out.length > budget && upTo > cur + 1) {
		upTo--;
		out = render(upTo);
	}
	if (out.length <= budget) return out;

	// 3. Cut the earliest content, keeping the course, the outline and the tail.
	const { head, body } = parts(upTo);
	const room = budget - head.length - TRUNCATED_NOTE.length - 4;
	const tail = room > 0 ? body.slice(Math.max(0, body.length - room)) : '';
	return `${head}\n\n${TRUNCATED_NOTE}\n${tail}\n`;
}
