/**
 * The `fake` provider: answers a card request from the request alone, the same way
 * every time, without calling anyone. For the end-to-end suite and for trying the
 * editor without a key. Its texts say what they are, so nobody mistakes them for a
 * model's.
 */
import type { GenRequest, Generated, GenQuestion } from '$lib/domain/authoring';
import type { Complete } from './provider';

function question(type: NonNullable<GenRequest['block']['question_type']>): GenQuestion {
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

export function fakeGenerated(request: GenRequest): Generated {
	const about = request.block.title || request.block.brief || 'karta';
	const missing = new Set(request.block.missing);
	const out: Generated = {};
	if (missing.has('content')) out.content_md = `Ukázkový text: ${about}.`;
	if (missing.has('question')) out.question = question(request.block.question_type ?? 'mcq_1');
	if (missing.has('feedback')) {
		const given = request.block.given.question as { options?: unknown[] } | undefined;
		out.option_feedback = (given?.options ?? []).map((_, i) => `Ukázková reakce ${i + 1}.`);
	}
	if (missing.has('hint')) out.hint_md = 'Ukázková nápověda.';
	if (missing.has('help')) out.help_md = 'Ukázková podrobná pomoc.';
	if (missing.has('solution')) out.solution_md = 'Ukázkové vysvětlení řešení.';
	return out;
}

/** The last user message is the request as JSON (`generate.ts`). */
export const fakeComplete: Complete = async (messages) => {
	const last = messages.findLast((m) => m.role === 'user' && m.content.startsWith('{'));
	const request = JSON.parse(last?.content ?? '{}') as GenRequest;
	return { text: JSON.stringify(fakeGenerated(request)), tokens: 0 };
};
