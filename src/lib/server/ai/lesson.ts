/**
 * Planning the new cards of a course, then writing them, a lesson per conversation and a
 * card per turn.
 *
 * The plan is one turn at high effort that decides, in writing, the course's terms,
 * notation, address and running examples and each card's purpose (`plan.ts`). A lesson's
 * conversation starts from that turn, its reasoning included, when the browser hands it
 * back; else from the dossier, where the plan's decisions are kept.
 *
 * A card arrives through the `write_card` tool, and the tool's result is the check: "ok",
 * or why the card cannot be used (`cardProblem`, `questionIsSound`), after which the model
 * writes the card again, twice at most; then the card is reported as failed and the
 * conversation goes on with the next. What the teacher wrote is sent as context and must
 * come back as `keep`, and `fillCard` checks again at write time.
 *
 * Every request defines both tools and has the same system prompt, so its opening is the
 * same for the plan and for every lesson: for the provider's prefix cache, and because a
 * host keeps the model's earlier reasoning only in a request with tools. With a plan the
 * opening (system prompt, materials, course dossier, the plan request and its answer) is
 * the same for every lesson of the course.
 */
import { cardProblem, generatedCardSchema, type GeneratedCard } from '$lib/domain/authoring';
import { MARKER_CLOSE, MARKER_OPEN } from '$lib/domain/dossier';
import {
	cardRequestOf,
	type LessonEvent,
	type LessonRequest,
	type PlanEvent
} from '$lib/domain/lesson-writing';
import { planProblem, planSchema, type Plan, type PlanRequest } from '$lib/domain/plan';
import { formatRules } from '$lib/ui/ai-format';
import type { LimitVerdict } from './limits';
import { parseJson } from './json';
import {
	PLAN_TIMEOUT_MS,
	ProviderError,
	type AssistantTurn,
	type Chat,
	type ChatMessage,
	type ToolName
} from './provider';

/** Bump when the rules below change what a card should say. */
export const LESSON_SPEC_VERSION = '1';

export const AUTHOR_SYSTEM_PROMPT = `You write learning cards ("karty") for a mobile learning app, for a teacher who reviews them afterwards. A course ("kurz") has lessons ("lekce"); a lesson has cards. A card is a short sequence of steps; each step is one screen on a phone: either a text step (explanation, example, summary) or a question step (a short task text plus one question the pupil answers).

The work comes in turns, and you answer every turn by calling the tool it asks for.

What you get first, as user messages, in this order:
1. When the teacher attached materials (Word, PowerPoint, PDF, scans): their text, or an index of them. Sections have keys in square brackets. They are the teacher's own source: take the facts, definitions, examples, notation and wording from them, at the level of the pupils, and follow them where they differ from what you would write. Do not copy whole passages: shorten and rephrase them into short screens. Never say "the materials", "the text" or a file name to the pupil, and never put a key in a card. What the materials do not contain you may add only from common school knowledge.
2. The course dossier: plain text, read-only background: the course, its audience, its lessons and the cards it has. "Poznámka pro AI" is a note for you (the teacher's, or a plan made earlier) and "Záměr karty" is what a card is for: follow both. When a card is shown between the lines "${MARKER_OPEN}" and "${MARKER_CLOSE}", it is only the place the teacher is working at. Never write about the dossier itself.

Then one of two tasks.

A. PLAN (a JSON message with "task":"plan"). The teacher accepted new cards, listed in "lessons" with numbers ("lesson", "card"), a kind and a title; they are still empty. Before any of them is written, decide how the course will be written, and call save_plan. Only what you write into the plan carries over to the cards: a decision you only think about is lost, so write every decision out, concretely, in course.language:
- "conventions": for the whole course: the terms you will use (and the ones you will avoid), the notation (how numbers, fractions, units, formulas are written, with an example of each), how the pupil is addressed (ty/vy, tone, sentence length, emoji), and the running examples (characters, objects, situations) that come back across cards. Where the dossier's "Poznámka pro AI", "Záměr karty" or the materials already decide something, take it over; do not contradict them. At most 1200 characters.
- "lessons": for each lesson of the request, {"lesson": <number>, "note": "…"}: what the lesson builds up, in which order, and the examples that run through it. At most 500 characters each. Leave a lesson out when there is nothing beyond the conventions.
- "cards": for every card of the request, {"card": <number>, "brief": "…"}: one to four sentences: what it teaches or practises, what it assumes the pupil already knows (from which earlier card or from prior knowledge), which example it uses, and for a practice or quiz card which mistake its questions are aimed at. A card whose "brief" the teacher already gave keeps that purpose; you may make it concrete. No two cards teach the same thing; later cards build on earlier ones.

B. LESSON (a JSON message with "task":"lesson"): the cards of one lesson are written one after another, one card a turn. Each turn is a JSON message with "write" (the card's number in this lesson, from 1) and "card"; answer it by calling write_card with the whole card. The cards of this lesson you wrote in earlier turns are what the pupil has seen just before: build on them, keep their terms, notation and examples, and do not repeat them. When a plan was made earlier in this conversation, "plan_card" is the card's number there: follow the plan's conventions and that card's brief. The result of write_card is "ok", or the reason the card was refused; then call write_card again with the whole card, corrected.

A card in a turn has its kind, title, an optional brief ("what the card is for"), and its existing steps. Each existing step has an "id", a "kind" (text, question or media), what the teacher already wrote, and "missing": the parts of that step that are still empty. "draws_on", when present, names the sections of the materials this card is written from.

write_card takes {"steps":[ … ]}. "steps" lists every step of the finished card, in order. Each item is one of:
- {"keep":"<id of an existing step>","fill":{…}} for every existing step, with "fill" holding exactly the parts listed in that step's "missing" (leave "fill" out when "missing" is empty). Keys of "fill", each only when that part is in "missing": "content_md" (content), "question" (question), "option_feedback" (feedback), "hint_md", "help_md", "solution_md".
- {"kind":"text","content_md":"…"} a new text step.
- {"kind":"question","content_md":"the task the pupil reads","question":{…},"hint_md":"…","help_md":"…","solution_md":"…"} a new question step; all six keys are required.

Hard rules for the structure:
- Every existing step appears exactly once, as "keep", in its original order. New steps go before, between or after them. Never rewrite, shorten, reorder or repeat what the teacher wrote, and never put a part into "fill" that is not in "missing".
- Never add a "keep" for an id that is not in the card.

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

/** The label on the materials message. */
export const LESSON_MATERIALS_LABEL = `The teacher's materials (source of facts, examples and wording; never mention them to the pupil):`;

/** Calls for one card: the first, and two after a refusal. */
const ATTEMPTS = 3;
/**
 * The longest one card's call may take. A card is written in seconds (under ten in the
 * runs measured, with short materials and little thinking); a host that has not answered
 * by now is taken not to, and the call is made once more (`lessonEvents`).
 */
export const CARD_TIMEOUT_MS = 90_000;

const materialsMessage = (materials: string | undefined): ChatMessage[] =>
	materials !== undefined && materials.trim() !== ''
		? [{ role: 'user', content: `${LESSON_MATERIALS_LABEL}\n\n${materials}` }]
		: [];

const dossierMessage = (context: string): ChatMessage[] =>
	context.trim() !== ''
		? [{ role: 'user', content: `Course dossier (read-only background):\n\n${context}` }]
		: [];

/** The plan's request as the model's last message: everything but the dossier and the materials. */
export function planMessage(request: PlanRequest): string {
	const { context: _context, materials: _materials, schema: _schema, ...rest } = request;
	return JSON.stringify({ task: 'plan', ...rest });
}

/** The plan's conversation up to its answer: the opening every lesson with a plan shares. */
export function planMessages(request: PlanRequest): ChatMessage[] {
	return [
		{ role: 'system', content: AUTHOR_SYSTEM_PROMPT },
		...materialsMessage(request.materials),
		...dossierMessage(request.context),
		{ role: 'user', content: planMessage(request) }
	];
}

/** The tool results that answer every call of a turn; only the first call of `tool` counts. */
function answer(turn: AssistantTurn, tool: ToolName, verdict: string): ChatMessage[] {
	let first = true;
	return (turn.tool_calls ?? []).map((call) => {
		const counts = first && call.function.name === tool;
		if (counts) first = false;
		return {
			role: 'tool' as const,
			tool_call_id: call.id,
			content: counts ? verdict : `Ignored: answer with one call of ${tool}.`
		};
	});
}

/** The arguments of the turn's first call of `tool`, or its text when it called none. */
function argumentsOf(turn: AssistantTurn, tool: ToolName): unknown {
	const call = turn.tool_calls?.find((c) => c.function.name === tool);
	if (call !== undefined) return parseJson(call.function.arguments);
	return parseJson(turn.content);
}

/** The next messages after a turn: the tool's results, or a reminder when it called no tool. */
function reply(turn: AssistantTurn, tool: ToolName, verdict: string): ChatMessage[] {
	if ((turn.tool_calls ?? []).length > 0) return answer(turn, tool, verdict);
	return [{ role: 'user', content: verdict === 'ok' ? 'ok' : `${verdict} Call ${tool}.` }];
}

function cardVerdict(
	request: LessonRequest,
	index: number,
	turn: AssistantTurn
): { use: GeneratedCard } | { say: string } {
	const json = argumentsOf(turn, 'write_card');
	if (json === undefined)
		return {
			say: 'Refused: the arguments were not valid JSON. Call write_card with {"steps":[…]}.'
		};
	const parsed = generatedCardSchema.safeParse(json);
	if (!parsed.success)
		return {
			say: `Refused: the card does not have the expected shape: ${parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}. Call write_card again with the whole card.`
		};
	const problem = cardProblem(cardRequestOf(request, index), parsed.data);
	if (problem !== undefined)
		return { say: `Refused: ${problem} Call write_card again with the whole card.` };
	return { use: parsed.data };
}

/** What the limits say before each call; the route counts each call as a request. */
export type Gate = () => LimitVerdict;
const open: Gate = () => ({ ok: true });

export interface PlanResult {
	plan: Plan;
	turn: AssistantTurn;
}

/** Ask for the plan, once and up to twice more when it does not cover every card. */
export async function makePlan(
	request: PlanRequest,
	chat: Chat,
	options: { gate?: Gate; spent?: (tokens: number) => void; signal?: AbortSignal } = {}
): Promise<PlanEvent> {
	const messages = planMessages(request);
	let reason = '';
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const verdict = (options.gate ?? open)();
		if (!verdict.ok)
			return { type: 'stopped', reason: verdict.reason, retryAfter: verdict.retryAfterSeconds };
		const { turn, tokens } = await chat(messages, {
			tool: 'save_plan',
			effort: 'high',
			timeoutMs: PLAN_TIMEOUT_MS,
			signal: options.signal
		});
		options.spent?.(tokens);
		const parsed = planSchema.safeParse(argumentsOf(turn, 'save_plan'));
		const problem = parsed.success
			? planProblem(request, parsed.data)
			: `the plan does not have the expected shape (${parsed.error.issues
					.slice(0, 3)
					.map((i) => `${i.path.join('.')}: ${i.message}`)
					.join('; ')})`;
		// Only the accepted turn is handed back: a lesson starts from the plan, not from the
		// attempts before it.
		if (problem === undefined && parsed.success) return { type: 'plan', plan: parsed.data, turn };
		reason = problem ?? '';
		messages.push(
			turn,
			...reply(turn, 'save_plan', `Refused: ${reason} Call save_plan again with the whole plan.`)
		);
	}
	console.error('[ai] plan rejected after', ATTEMPTS, 'attempts:', reason, {
		cards: request.lessons.reduce((n, l) => n + l.cards.length, 0),
		contextChars: request.context.length
	});
	return { type: 'failed', problem: 'failed' };
}

/** The lesson's request as the model's message: what holds for all its cards. */
export function lessonMessage(request: LessonRequest): string {
	return JSON.stringify({
		task: 'lesson',
		course: request.course,
		lesson: request.lesson,
		cards: request.cards.map((c, i) => ({
			write: i + 1,
			kind: c.kind,
			title: c.title,
			...(c.plan_card !== undefined ? { plan_card: c.plan_card } : {})
		}))
	});
}

/** One card's turn. */
export function cardMessage(request: LessonRequest, index: number): string {
	const { plan_card, draws_on, ...card } = request.cards[index];
	return JSON.stringify({
		write: index + 1,
		...(plan_card !== undefined ? { plan_card } : {}),
		card,
		...(draws_on !== undefined && draws_on.length > 0 ? { draws_on } : {})
	});
}

/**
 * The conversation's opening. With a plan: the plan's conversation and its accepted
 * answer, the same for every lesson; then this lesson's materials, if the plan did not
 * have them all, and the lesson as it is now. Without: the materials and the dossier.
 */
export function lessonOpening(request: LessonRequest): ChatMessage[] {
	const out: ChatMessage[] = [];
	if (request.plan !== undefined) {
		const turn = request.plan.turn as AssistantTurn;
		out.push(...planMessages(request.plan.request), turn, ...reply(turn, 'save_plan', 'ok'));
		out.push(...materialsMessage(request.materials));
		if (request.context.trim() !== '')
			out.push({ role: 'user', content: `The lesson as it is now:\n\n${request.context}` });
	} else {
		out.push(
			{ role: 'system', content: AUTHOR_SYSTEM_PROMPT },
			...materialsMessage(request.materials),
			...dossierMessage(request.context)
		);
	}
	out.push({ role: 'user', content: lessonMessage(request) });
	return out;
}

/**
 * Write the lesson's cards, in order, in one conversation; events as it goes. A provider
 * failure is thrown, with every card written before it already sent.
 */
export async function* lessonEvents(
	request: LessonRequest,
	chat: Chat,
	options: { gate?: Gate; spent?: (tokens: number) => void; signal?: AbortSignal } = {}
): AsyncGenerator<LessonEvent> {
	const messages = lessonOpening(request);
	for (let index = 0; index < request.cards.length; index++) {
		yield { type: 'writing', card: index };
		messages.push({ role: 'user', content: cardMessage(request, index) });
		let reason = '';
		let written: GeneratedCard | undefined;
		// A call that did not get through (the host hung, the connection broke) is made once
		// more for the card, with the conversation as it was; it is not one of the attempts.
		let again = true;
		for (let attempt = 0; attempt < ATTEMPTS && written === undefined; attempt++) {
			const verdict = (options.gate ?? open)();
			if (!verdict.ok) {
				yield { type: 'stopped', reason: verdict.reason, retryAfter: verdict.retryAfterSeconds };
				return;
			}
			let answered: Awaited<ReturnType<Chat>>;
			try {
				answered = await chat(messages, {
					tool: 'write_card',
					timeoutMs: CARD_TIMEOUT_MS,
					signal: options.signal
				});
			} catch (e) {
				const lost = e instanceof ProviderError && e.kind === 'network';
				if (!lost || !again || options.signal?.aborted === true) throw e;
				again = false;
				console.error('[ai] card call lost, calling once more:', e.message);
				attempt--;
				continue;
			}
			const { turn, tokens } = answered;
			options.spent?.(tokens);
			const result = cardVerdict(request, index, turn);
			messages.push(turn, ...reply(turn, 'write_card', 'use' in result ? 'ok' : result.say));
			if ('use' in result) written = result.use;
			else reason = result.say;
		}
		if (written !== undefined) {
			yield { type: 'card', card: index, answer: written };
			continue;
		}
		// What the operator needs to see why; never the course's text.
		const card = request.cards[index];
		console.error('[ai] card rejected after', ATTEMPTS, 'attempts:', reason, {
			kind: card.kind,
			steps: card.steps.length,
			missing: card.steps.filter((s) => s.missing.length > 0).length,
			turn: index + 1,
			planned: request.plan !== undefined
		});
		yield { type: 'card-failed', card: index };
	}
	yield { type: 'done' };
}
