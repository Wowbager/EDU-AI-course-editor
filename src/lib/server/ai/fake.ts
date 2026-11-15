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
import type { Complete } from './provider';

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

/** The last user message that is JSON is the request (`generate.ts`). */
export const fakeComplete: Complete = async (messages) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as GenRequest;
	return { text: JSON.stringify(fakeCard(request)), tokens: 0 };
};
