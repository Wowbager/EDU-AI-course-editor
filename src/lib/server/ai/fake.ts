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
import type { AssistantTurn, Chat, Complete, Message, Stream, Vision } from './provider';
import type { Plan, PlanRequest } from '$lib/domain/plan';
import type { SourcesRequest } from '$lib/domain/source-assign';
import type { Outline, OutlineCard, OutlineRequest } from '$lib/domain/outline';

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
 * A proposal from the request alone. A place in a lesson gets three cards, any other a
 * course of two lessons; a change keeps the proposal and appends one card that carries the
 * instruction, so a suite can tell that the proposal was replaced. A change to a place of
 * the other kind regroups the cards: all in one, or in one lesson „Přesunutá lekce“.
 */
export function fakeOutline(
	request: OutlineRequest,
	keys: readonly string[] = request.material_keys ?? []
): Outline {
	// With materials the first card is written from the first section, the last from the
	// last two, so a suite can see the source lines and what a card's request carried.
	const card = (
		kind: 'display' | 'question' | 'exercise',
		name: string,
		sources?: string[]
	): OutlineCard => ({
		kind,
		name,
		...(sources !== undefined && sources.length > 0 ? { sources } : {})
	});
	if (request.current !== undefined) {
		const change = card('display', `Změna: ${request.prompt}`);
		const current = request.current;
		if (current.scope !== request.place.scope) {
			const cards = [
				...(current.scope === 'cards' ? current.cards : current.lessons.flatMap((l) => l.cards)),
				change
			];
			return request.place.scope === 'cards'
				? { scope: 'cards', cards }
				: { scope: 'lessons', lessons: [{ name: 'Přesunutá lekce', cards }] };
		}
		return current.scope === 'cards'
			? { scope: 'cards', cards: [...current.cards, change] }
			: {
					scope: 'lessons',
					// A lesson the teacher left without cards gets one, as the model is asked to.
					lessons: current.lessons.map((l, i, all) => {
						const cards = l.cards.length > 0 ? l.cards : [card('display', `Úvod: ${l.name}`)];
						return { ...l, cards: i === all.length - 1 ? [...cards, change] : cards };
					})
				};
	}
	if (request.place.scope === 'cards')
		return {
			scope: 'cards',
			cards: [
				card('exercise', 'Příklady k procvičení', keys.slice(0, 1)),
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
					card('display', 'Co to je', keys.slice(0, 1)),
					card('exercise', 'Procvičení'),
					card('question', 'Ověření')
				]
			},
			{
				name: 'Druhá lekce',
				cards: [card('display', 'Jak se to používá', keys.slice(-2)), card('exercise', 'Úlohy')]
			}
		]
	};
}

/** The section keys the model sees, in the order of the materials. */
const keysIn = (messages: readonly Message[]): string[] => [
	...new Set(
		messages.flatMap((m) => [...m.content.matchAll(/\[([0-9a-f]{8}\.\d{1,4})\]/g)].map((k) => k[1]))
	)
];

/**
 * Sources for cards: the i-th card gets the i-th section (round the list), and a key
 * nobody has, which must be dropped.
 */
export function fakeSources(
	request: Pick<SourcesRequest, 'cards'>,
	keys: readonly string[]
): { cards: { id: string; sources: string[] }[] } {
	return {
		cards: request.cards.map((c, i) => ({
			id: c.id,
			sources: keys.length === 0 ? [] : [keys[i % keys.length], 'deadbeef.999']
		}))
	};
}

/** The last user message that is JSON is the request (`generate.ts`, `outline.ts`, `sources.ts`). */
export const fakeComplete: Complete = async (messages) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as GenRequest | OutlineRequest | SourcesRequest;
	if ('schema' in request && request.schema === 'eduai.outline-request/1')
		return { text: JSON.stringify(fakeOutline(request)), tokens: 0 };
	if ('schema' in request && request.schema === 'eduai.sources-request/1')
		return { text: JSON.stringify(fakeSources(request, keysIn(messages))), tokens: 0 };
	return { text: JSON.stringify(fakeCard(request as GenRequest)), tokens: 0 };
};

/** The plan from its request alone: a brief the teacher gave is kept as it is. */
export function fakePlan(request: Pick<PlanRequest, 'lessons'>): Plan {
	return {
		conventions: 'Ukázkové úmluvy kurzu.',
		lessons: request.lessons.map((l) => ({
			lesson: l.lesson,
			note: `Ukázková poznámka: ${l.name}.`
		})),
		cards: request.lessons.flatMap((l) =>
			l.cards.map((c) => ({ card: c.card, brief: c.brief ?? `Ukázkový záměr: ${c.title}.` }))
		)
	};
}

/** What the fake "thinks", so a suite can see that it is handed back. */
export const FAKE_REASONING = [
	{ type: 'reasoning.text', text: 'Ukázková úvaha.', format: 'unknown', index: 0 }
];

/**
 * A turn of a conversation (`lesson.ts`): the plan for a plan's request, else the card
 * the last card turn asks for, as a call of the tool it was asked for.
 */
export const fakeChat: Chat = async (messages, { tool }) => {
	const last = (prefix: string) =>
		messages.findLast(
			(m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(prefix)
		)?.content;
	const args =
		tool === 'save_plan'
			? fakePlan(JSON.parse(last('{"task":"plan"') ?? '{"lessons":[]}') as PlanRequest)
			: fakeCard(JSON.parse(last('{"write"') ?? '{}') as GenRequest);
	const turn: AssistantTurn = {
		role: 'assistant',
		content: '',
		tool_calls: [
			{
				id: `fake-${messages.length}`,
				type: 'function',
				function: { name: tool, arguments: JSON.stringify(args) }
			}
		],
		reasoning_details: FAKE_REASONING
	};
	return { turn, tokens: 0 };
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Between two lessons of a streamed proposal, so a browser suite can see it growing. */
export const FAKE_LESSON_DELAY_MS = 400;

/** The proposal as the stream carries it: the scope line, then a lesson or card per line. */
export const fakeStream: Stream = async (messages, onText) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as OutlineRequest;
	// The model sees the sections' keys in the materials message, not in the request.
	const keys = keysIn(messages);
	const outline = fakeOutline(request, keys);
	onText(`${JSON.stringify({ scope: outline.scope })}\n`);
	const items = outline.scope === 'cards' ? outline.cards : outline.lessons;
	for (const [i, item] of items.entries()) {
		if (i > 0) await pause(FAKE_LESSON_DELAY_MS);
		onText(`${JSON.stringify(item)}\n`);
	}
	return { tokens: 0 };
};

/** What the fake reads of a picture: the same line every time, whatever the picture. */
export const FAKE_READING = 'Ukázkový přepis obrázku: $x + 1 = 3$.';

export const fakeRead: Vision = async () => ({ text: FAKE_READING, tokens: 0 });
