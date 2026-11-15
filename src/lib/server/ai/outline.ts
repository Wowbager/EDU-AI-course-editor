/**
 * Propose a structure: ask the model for lessons with cards, or for cards of one lesson,
 * and accept only an answer that is valid JSON of the right shape. A bad answer is sent
 * back with the reason, twice at most; then the proposal is reported as failed.
 *
 * Message order is for the provider's prefix cache, as in `generate.ts`: the system
 * prompt, then the dossier, then the request.
 */
import {
	outlineProblem,
	outlineSchema,
	type Outline,
	type OutlineRequest
} from '$lib/domain/outline';
import { MARKER_CLOSE, MARKER_OPEN } from '$lib/domain/dossier';
import { parseJson } from './generate';
import type { Complete, Message } from './provider';

export type OutlineResponse = { status: 'ok'; outline: Outline } | { status: 'failed' };

export const OUTLINE_SYSTEM_PROMPT = `You plan the structure of a course ("kurz") for a mobile learning app, for a teacher who will review your proposal before anything is written. A course has lessons ("lekce"); a lesson has cards ("karty"). A card is a short sequence of screens on a phone; it is written later, from the name and the one-line brief you give it.

You get two user messages.
1. The course dossier: plain text, read-only background: the course, its audience, its outline and the lessons and cards it already has. When a card is shown between the lines "${MARKER_OPEN}" and "${MARKER_CLOSE}", it is only the place the teacher is working at; it is not something to write about.
2. A JSON request: "prompt" is what the teacher asks for. "target" says where new cards would go: the lesson and the card the teacher has selected (by name), and how many lessons the course has. "course" has the title, the language and the audience. "current", when present, is the proposal the teacher is looking at and "prompt" is what they want changed in it ("original" is what they asked for first): rework it, keep what they did not ask to change exactly as it is (names, order, wording of the briefs), and return the whole proposal again.

Decide what the teacher wants and answer with one JSON object and nothing else, in one of two shapes.
- A course structure, when the prompt is about a whole course, a topic with several lessons, or says how many lessons:
  {"scope":"lessons","lessons":[{"name":"…","takeaway":"…","cards":[{"kind":"display","name":"…","brief":"…"}]}]}
- Cards for the lesson the teacher is in, when the prompt asks for cards, an example set, a quiz, a revision or "add something" and "target.lesson" exists:
  {"scope":"cards","cards":[{"kind":"exercise","name":"…","brief":"…"}]}
  With no "target.lesson" (and "target.lessons" 0) use the first shape. When the prompt is unclear, and a lesson is selected, prefer cards.

Each card has a "kind":
- "display": an explanation (Výklad): the pupil reads;
- "question": one quiz question or a few straight in a line (Otázka);
- "exercise": a set of practice tasks of rising difficulty (Cvičení).
"name" is short, in the words a pupil or teacher would use, never numbered ("Co je polovina", not "Karta 1"). "brief" is one sentence in the language of the course on what the card is for and what it holds; when the teacher states a count you may put it there ("5 příkladů na sčítání"). A lesson's "takeaway" is one short sentence: what the pupil can do afterwards.

Rules:
- Language: course.language (Czech when empty). Vocabulary and ambition fit audience.grade and audience.purpose; do not plan what audience.prior_knowledge says the pupils already know, and do not repeat what the existing lessons in the dossier already teach.
- Build up: explain first, then practise, then check. A lesson usually has 3 to 7 cards, mixing the three kinds with more "display" and "exercise" than "question"; honour the numbers the teacher states (lessons, cards, "a quiz at the end").
- Do not invent facts, and never mention files, images or links.
- No empty strings, no extra keys, at most 12 lessons and 15 cards per lesson.`;

const ATTEMPTS = 3;

function verdictOn(request: OutlineRequest, raw: string): { use: Outline } | { say: string } {
	const json = parseJson(raw);
	if (json === undefined)
		return { say: 'Your answer was not valid JSON. Answer again with one JSON object.' };
	const parsed = outlineSchema.safeParse(json);
	if (!parsed.success)
		return {
			say: `Your answer does not have the expected shape: ${parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}. Answer again with one JSON object.`
		};
	const problem = outlineProblem(request, parsed.data);
	if (problem !== undefined) return { say: `${problem} Answer again.` };
	return { use: parsed.data };
}

/** What the request holds apart from the dossier, as the model's last message. */
export function outlineMessage(request: OutlineRequest): string {
	const { context: _context, ...rest } = request;
	return JSON.stringify(rest);
}

export async function generateOutline(
	request: OutlineRequest,
	complete: Complete,
	spent: (tokens: number) => void = () => {}
): Promise<{ response: OutlineResponse; tokens: number }> {
	const messages: Message[] = [{ role: 'system', content: OUTLINE_SYSTEM_PROMPT }];
	if (request.context.trim() !== '')
		messages.push({
			role: 'user',
			content: `Course dossier (read-only background):\n\n${request.context}`
		});
	messages.push({ role: 'user', content: outlineMessage(request) });
	let tokens = 0;
	let reason = '';
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const answer = await complete(messages);
		tokens += answer.tokens;
		spent(answer.tokens);
		const verdict = verdictOn(request, answer.text);
		if ('use' in verdict) return { response: { status: 'ok', outline: verdict.use }, tokens };
		reason = verdict.say;
		messages.push(
			{ role: 'assistant', content: answer.text },
			{ role: 'user', content: verdict.say }
		);
	}
	// What the operator needs to see why; never the course's text or the teacher's prompt.
	console.error('[ai] outline rejected after', ATTEMPTS, 'attempts:', reason, {
		changing: request.current !== undefined,
		promptChars: request.prompt.length,
		contextChars: request.context.length
	});
	return { response: { status: 'failed' }, tokens };
}
