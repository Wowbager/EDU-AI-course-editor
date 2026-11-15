/**
 * Write one card: ask the model for its steps, and accept only an answer that is valid
 * JSON of the right shape, keeps every step the teacher wrote and fills nothing the
 * teacher filled.
 *
 * Two things here do not rely on the model behaving:
 *  - what the teacher wrote is sent as context and must come back as `keep`: the answer
 *    is checked step by step (`cardProblem`), and `fillCard` checks again at write time;
 *  - the number of right answers is counted, not believed (`questionIsSound`).
 * An answer that fails is sent back with the reason, twice at most; then the card is
 * reported as failed and nothing is written.
 *
 * Message order is for the provider's prefix cache: the system prompt and the dossier's
 * opening (course, outline, earlier lessons) are the same for every card of a lesson;
 * the dossier differs from the marked card on, and the request is the last message.
 */
import {
	cardProblem,
	generatedCardSchema,
	type GenRequest,
	type GeneratedCard
} from '$lib/domain/authoring';
import type { Complete, Message } from './provider';
import { MARKER_CLOSE, MARKER_OPEN } from '$lib/domain/dossier';
import { formatRules } from '$lib/ui/ai-format';

/** The label on the materials message, after the dossier. */
export const MATERIALS_LABEL = `The teacher's materials (source of facts, examples and wording for this card; never mention them to the pupil):`;

export type GenResponse = { status: 'ok'; card: GeneratedCard } | { status: 'failed' };

/** Bump when the rules below change what a card should say; later it keys the cache. */
export const SPEC_VERSION = '4';

export const SYSTEM_PROMPT = `You write one learning card ("karta") for a mobile learning app. A card is a short sequence of steps; each step is one screen on a phone: either a text step (explanation, example, summary) or a question step (a short task text plus one question the pupil answers).

You get two or three user messages.
1. The course dossier: plain text, read-only background. It holds the course, its lessons and the cards of the earlier lessons and of this lesson, with the card you write between the lines "${MARKER_OPEN}" and "${MARKER_CLOSE}". Use it to build on what the pupil has already seen, to keep the course's notation, wording and difficulty, and not to repeat earlier cards or take the topic of later ones. Never write about the dossier itself.
2. When the teacher attached materials (Word, PowerPoint, PDF, scans): their text, or an index of them. Sections have keys in square brackets; "This card draws mainly on" names the ones this card was planned from. They are the teacher's own source: take the facts, definitions, examples, notation and wording from them, at the level of the pupils, and follow them where they differ from what you would write. Do not copy whole passages: shorten and rephrase them into short screens. Never say "the materials", "the text" or a file name to the pupil, and never put a key in the card. What the materials do not contain you may add only from common school knowledge.
3. A JSON request: the course and its audience, the lesson, and the card: its kind, title, an optional brief ("what the card is for"), and its existing steps. Each existing step has an "id", a "kind" (text, question or media), what the teacher already wrote, and "missing": the parts of that step that are still empty.

Write the whole card and answer with one JSON object and nothing else:
{"steps":[ … ]}
"steps" lists every step of the finished card, in order. Each item is one of:
- {"keep":"<id of an existing step>","fill":{…}} for every existing step, with "fill" holding exactly the parts listed in that step's "missing" (leave "fill" out when "missing" is empty). Keys of "fill", each only when that part is in "missing": "content_md" (content), "question" (question), "option_feedback" (feedback), "hint_md", "help_md", "solution_md".
- {"kind":"text","content_md":"…"} a new text step.
- {"kind":"question","content_md":"the task the pupil reads","question":{…},"hint_md":"…","help_md":"…","solution_md":"…"} a new question step; all six keys are required.

Hard rules for the structure:
- Every existing step appears exactly once, as "keep", in its original order. New steps go before, between or after them. Never rewrite, shorten, reorder or repeat what the teacher wrote, and never put a part into "fill" that is not in "missing".
- Never add a "keep" for an id that is not in the request.

How many steps (the card's "kind"):
- "display" (explanation): 1 to 6 text steps, no question steps. Split the explanation over screens, for example idea, then example, then summary.
- "exercise" (practice): 2 to 8 question steps, from easier to harder, each with its own short task text, hint, help and solution. A short text step may introduce the set.
- "question" (quiz question): 1 to 4 question steps in a straight line, no branching. A short text step may come before a question.
- Choose the number that suits the topic and the brief. If the teacher states a number in the brief or title ("5 příkladů", "tři otázky"), write exactly that number; it wins over the ranges above. Existing steps count towards the number.

A question is one of
  {"type":"yes_no","answer":true|false,"feedback_true":"…","feedback_false":"…"}
  {"type":"number","answer":<number>,"tolerance":<number, 0 when exact>}
  {"type":"mcq_1","options":[{"text":"…","correct":true|false,"feedback":"…"}]}  exactly one correct, 3–4 options
  {"type":"mcq_n","options":[…]}  at least two correct and at least one wrong, 4–6 options; the task must say that several answers are right
  {"type":"open","answer":"plain text: every accepted answer on its own line, such as 21/30 and then 7/10; for 'explain in your own words' the key points, one per line, without bullet marks"}
Use "number" only when the pupil types a whole or decimal number. A fraction answer is a choice question (mcq_1) or an open question answered as typed text such as 3/4. When a step has "question_type", use exactly that type. Otherwise choose the type that suits the task, and vary the types over the card where it makes sense. "option_feedback" is an array with one reaction for each option in that step's given question options, in the same order.

Rules for what you write:
- Language: course.language. Address, sentence length and emoji follow audience.register; when it is empty and the language is Czech, use informal "ty", short sentences and emoji sparingly. Vocabulary fits audience.grade. Do not explain again what audience.prior_knowledge says the pupil already knows.
- audience.purpose: "intro" is a first explanation, "practice" is practising, "exam_prep" is preparing for an exam; it sets the style and how demanding the questions are.
- Length: a text step has 20 to 80 visible words, closer to 20 for younger pupils. A task text is shorter.
- A card builds only on the earlier cards and the prior knowledge; a task must be solvable from them and from the steps above it. Do not repeat what other cards of the course teach.
- For yes_no the statement in the task is clearly true or clearly false, and both feedback texts make sense: feedback_true is what the pupil reads after answering Ano, feedback_false after Ne, so each says whether that answer is right and why, whichever answer is correct. For number, the unit belongs in the task, not in the answer.
- hint_md is a nudge: it shows where to look. It must not contain the answer or determine it.
- help_md is a rescue: it may lead the pupil to the answer, typically by the rule the task is about.
- solution_md says the correct answer and, mainly, why. It does not start with a heading such as "Vysvětlení:"; the app draws that.
- Hint, help and solution do three different jobs. They are not three versions of the same text.
- A wrong option is a mistake pupils really make, or a neighbouring concept; never nonsense, and never also correct.
- Feedback on a wrong option explains why it does not hold; "Špatně." is not enough. For a correct option short praise is enough.
- Maths goes between dollar signs wherever the field below allows it, for example $\\frac{1}{2}$, and that includes a lone variable or number in a sentence: write $x$, never x. Where a field is plain text, write maths as typed text.
- Text is Markdown only where the app draws it as Markdown. Field by field:
${formatRules({ names: false })}
- Keep the short parts short: a hint is one sentence; help is at most two sentences; a solution is at most three; the feedback on a wrong option is one sentence, on the correct one a few words of praise.
- Do not invent facts beyond common school knowledge of the topic and the teacher's materials, and never mention files, images or links.`;

const ATTEMPTS = 3;

/** The model's text as an object: it may wrap the JSON in a code fence or a sentence. */
export function parseJson(text: string): unknown {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return undefined;
	try {
		return JSON.parse(text.slice(start, end + 1));
	} catch {
		return undefined;
	}
}

/** `null` when the answer can be used, else what to tell the model. */
function problemWith(request: GenRequest, raw: string): { use: GeneratedCard } | { say: string } {
	const json = parseJson(raw);
	if (json === undefined)
		return {
			say: 'Your answer was not valid JSON. Answer again with one JSON object {"steps":[…]}.'
		};
	const parsed = generatedCardSchema.safeParse(json);
	if (!parsed.success)
		return {
			say: `Your answer does not have the expected shape: ${parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}. Answer again with one JSON object.`
		};
	const problem = cardProblem(request, parsed.data);
	if (problem !== undefined) return { say: `${problem} Answer again with the whole card.` };
	return { use: parsed.data };
}

/** What the request holds apart from the dossier, as the model's last message. */
export function requestMessage(request: GenRequest): string {
	const { context: _context, materials: _materials, ...rest } = request;
	return JSON.stringify(rest);
}

export async function generateCard(
	request: GenRequest,
	complete: Complete,
	/** Told what each call used as it returns, so a later failure does not lose the count. */
	spent: (tokens: number) => void = () => {}
): Promise<{ response: GenResponse; tokens: number }> {
	const messages: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }];
	if (request.context.trim() !== '')
		messages.push({
			role: 'user',
			content: `Course dossier (read-only background):\n\n${request.context}`
		});
	if (request.materials !== undefined && request.materials.trim() !== '')
		messages.push({ role: 'user', content: `${MATERIALS_LABEL}\n\n${request.materials}` });
	messages.push({ role: 'user', content: requestMessage(request) });
	let tokens = 0;
	let reason = '';
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const answer = await complete(messages);
		tokens += answer.tokens;
		spent(answer.tokens);
		const verdict = problemWith(request, answer.text);
		if ('use' in verdict) return { response: { status: 'ok', card: verdict.use }, tokens };
		reason = verdict.say;
		messages.push(
			{ role: 'assistant', content: answer.text },
			{ role: 'user', content: verdict.say }
		);
	}
	// What the operator needs to see why; never the course's text.
	console.error('[ai] card rejected after', ATTEMPTS, 'attempts:', reason, {
		kind: request.card.kind,
		steps: request.card.steps.length,
		missing: request.card.steps.filter((s) => s.missing.length > 0).length,
		contextChars: request.context.length
	});
	return { response: { status: 'failed' }, tokens };
}
