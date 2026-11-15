/**
 * The `fake` provider: answers a card request from the request alone, the same way
 * every time, without calling anyone. For the end-to-end suite and for trying the
 * editor without a key. Its texts say what they are, so nobody mistakes them for a
 * model's.
 */
import type {
	Fill,
	GenQuestion,
	GenQuestionType,
	GenRequest,
	GeneratedCard,
	GeneratedStep
} from '$lib/domain/authoring';
import type { Complete, Stream } from './provider';
import type { Outline, OutlineRequest } from '$lib/domain/outline';

function question(type: GenQuestionType): GenQuestion {
	switch (type) {
		case 'yes_no':
			return {
				type,
				answer: true,
				feedback_true: 'Ukázková reakce na Ano.',
				feedback_false: 'Ukázková reakce na Ne.'
			};
		case 'number':
			return { type, answer: 42 };
		case 'open':
			return { type, answer: 'Ukázková vzorová odpověď.' };
		default: {
			const count = type === 'mcq_n' ? 4 : 3;
			const right = type === 'mcq_n' ? 2 : 1;
			return {
				type,
				options: Array.from({ length: count }, (_, i) => ({
					text: `Ukázková odpověď ${i + 1}`,
					correct: i < right,
					feedback: `Ukázková reakce ${i + 1}.`
				}))
			};
		}
	}
}

export function fakeCard(request: GenRequest): GeneratedCard {
	const about = request.card.title || request.card.brief || 'karta';
	const steps: GeneratedStep[] = request.card.steps.map((step) => {
		const missing = new Set(step.missing);
		const fill: Fill = {};
		if (missing.has('content')) fill.content_md = `Ukázkový text: ${about}.`;
		if (missing.has('question')) fill.question = question(step.question_type ?? 'mcq_1');
		if (missing.has('feedback')) {
			const given = step.question as { options?: unknown[] } | undefined;
			fill.option_feedback = (given?.options ?? []).map((_, i) => `Ukázková reakce ${i + 1}.`);
		}
		if (missing.has('hint')) fill.hint_md = 'Ukázková nápověda.';
		if (missing.has('help')) fill.help_md = 'Ukázková podrobná pomoc.';
		if (missing.has('solution')) fill.solution_md = 'Ukázkové vysvětlení řešení.';
		return Object.keys(fill).length > 0 ? { keep: step.id, fill } : { keep: step.id };
	});
	// More than the teacher has: a display card gets two more screens, any other card one
	// more question.
	if (request.card.kind === 'display') {
		for (const n of [2, 3])
			steps.push({ kind: 'text', content_md: `Ukázkový text ${n}: ${about}.` });
	} else {
		steps.push({
			kind: 'question',
			content_md: `Ukázkové zadání 2: ${about}.`,
			question: question('mcq_1'),
			hint_md: 'Ukázková nápověda.',
			help_md: 'Ukázková podrobná pomoc.',
			solution_md: 'Ukázkové vysvětlení řešení.'
		});
	}
	return { steps };
}

/**
 * A proposal from the request alone. A prompt that mentions „karty“ gets cards, any other
 * a course of two lessons; a change keeps the proposal and appends one card that carries
 * the instruction, so a suite can tell that the proposal was replaced.
 */
export function fakeOutline(request: OutlineRequest): Outline {
	const card = (kind: 'display' | 'question' | 'exercise', name: string) => ({
		kind,
		name
	});
	if (request.current !== undefined) {
		const change = card('display', `Změna: ${request.prompt}`);
		const current = request.current;
		return current.scope === 'cards'
			? { scope: 'cards', cards: [...current.cards, change] }
			: {
					scope: 'lessons',
					lessons: current.lessons.map((l, i, all) =>
						i === all.length - 1 ? { ...l, cards: [...l.cards, change] } : l
					)
				};
	}
	if (/karty/i.test(request.prompt) && request.target.lessons > 0)
		return {
			scope: 'cards',
			cards: [
				card('exercise', 'Příklady k procvičení'),
				card('question', 'Kvíz na závěr'),
				card('display', 'Shrnutí')
			]
		};
	return {
		scope: 'lessons',
		lessons: [
			{
				name: 'První lekce',
				cards: [
					card('display', 'Co to je'),
					card('exercise', 'Procvičení'),
					card('question', 'Ověření')
				]
			},
			{
				name: 'Druhá lekce',
				cards: [card('display', 'Jak se to používá'), card('exercise', 'Úlohy')]
			}
		]
	};
}

/** The last user message that is JSON is the request (`generate.ts`, `outline.ts`). */
export const fakeComplete: Complete = async (messages) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as GenRequest | OutlineRequest;
	if ('schema' in request && request.schema === 'eduai.outline-request/1')
		return { text: JSON.stringify(fakeOutline(request)), tokens: 0 };
	return { text: JSON.stringify(fakeCard(request as GenRequest)), tokens: 0 };
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Between two lessons of a streamed proposal, so a browser suite can see it growing. */
export const FAKE_LESSON_DELAY_MS = 150;

/** The proposal as the stream carries it: the scope line, then a lesson or card per line. */
export const fakeStream: Stream = async (messages, onText) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as OutlineRequest;
	const outline = fakeOutline(request);
	onText(`${JSON.stringify({ scope: outline.scope })}\n`);
	const items = outline.scope === 'cards' ? outline.cards : outline.lessons;
	for (const [i, item] of items.entries()) {
		if (i > 0) await pause(FAKE_LESSON_DELAY_MS);
		onText(`${JSON.stringify(item)}\n`);
	}
	return { tokens: 0 };
};
