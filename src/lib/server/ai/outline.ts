/**
 * Propose a structure, streamed: the model writes one lesson per line (or one card per
 * line) and each line that is valid is passed on as it arrives, so the teacher sees the
 * first lesson after a second or two instead of the whole proposal after ten.
 *
 * A line that is not valid does not spoil the others. When the model has finished, the
 * bad lines are sent back with their reasons and only those are asked for again, up to
 * twice. A scope that cannot be used (cards for a course with no lesson) is the one fault
 * that asks for the whole proposal again, since every line after it depends on it.
 *
 * Message order is for the provider's prefix cache, as in `generate.ts`: the system
 * prompt, then the dossier, then the request.
 */
import {
	applyEvent,
	lineSplitter,
	outlineSchema,
	readLine,
	scopeProblem,
	type OutlineEvent,
	type OutlineRequest,
	type Outline
} from '$lib/domain/outline';
import { MARKER_CLOSE, MARKER_OPEN } from '$lib/domain/dossier';
import { formatRules } from '$lib/ui/ai-format';
import type { Message, Stream } from './provider';

export const OUTLINE_SYSTEM_PROMPT = `You plan the structure of a course ("kurz") for a mobile learning app, for a teacher who will review your proposal before anything is written. A course has lessons ("lekce"); a lesson has cards ("karty"). A card is a short sequence of screens on a phone; it is written later, from its name, the outline around it and the teacher's request, so the names have to say what each card is about.

You get two user messages.
1. The course dossier: plain text, read-only background: the course, its audience, its outline and the lessons and cards it already has. When a card is shown between the lines "${MARKER_OPEN}" and "${MARKER_CLOSE}", it is only the place the teacher is working at; it is not something to write about.
2. A JSON request: "prompt" is what the teacher asks for. "target" says where new cards would go: the lesson and the card the teacher has selected (by name), and how many lessons the course has. "course" has the title, the language and the audience. "current", when present, is the proposal the teacher is looking at and "prompt" is what they want changed in it ("original" is what they asked for first): rework it, keep what they did not ask to change exactly as it is (names, order), and return the whole proposal again.

Answer in lines, one JSON object per line, and nothing else (no code fence, no commentary). The first line says what you propose:
{"scope":"lessons"} a course structure, when the prompt is about a whole course, a topic with several lessons, or says how many lessons;
{"scope":"cards"} cards for the lesson the teacher is in, when the prompt asks for cards, an example set, a quiz, a revision or "add something" and "target.lesson" exists. Without "target.lesson" (no lesson is selected) always use "lessons". When the prompt is unclear and a lesson is selected, prefer cards.
After it, for "lessons", one line for each lesson, in course order:
{"name":"Lesson name","cards":[{"kind":"display","name":"Card name"},{"kind":"exercise","name":"Card name"}]}
and for "cards", one line for each card:
{"kind":"exercise","name":"Card name"}

A card's "kind" is
- "display": an explanation (Výklad): the pupil reads;
- "question": one quiz question or a few straight in a line (Otázka);
- "exercise": a set of practice tasks of rising difficulty (Cvičení).
A name is short, in the words a pupil or teacher would use, and never numbered ("Co je polovina", not "Karta 1"). When the teacher states a count for a card, put it in the name ("5 příkladů na sčítání"). Write nothing else about a card or lesson: no description, no goal.

Rules:
- Language: course.language (Czech when empty). Vocabulary and ambition fit audience.grade and audience.purpose; do not plan what audience.prior_knowledge says the pupils already know, and do not repeat what the existing lessons in the dossier already teach.
- Build up: explain first, then practise, then check. A lesson usually has 3 to 7 cards, mixing the three kinds with more "display" and "exercise" than "question"; honour the numbers the teacher states (lessons, cards, "a quiz at the end").
- Do not invent facts, and never mention files, images or links.
- At most 12 lessons and 15 cards per lesson.
${formatRules({ fields: false })}`;

const ATTEMPTS = 3;

/** What the request holds apart from the dossier, as the model's last message. */
export function outlineMessage(request: OutlineRequest): string {
	const { context: _context, ...rest } = request;
	return JSON.stringify(rest);
}

/** Events put in one end of a queue and taken out of the other, while a stream runs. */
function channel<T>() {
	const items: T[] = [];
	let wake: (() => void) | undefined;
	let closed = false;
	return {
		push(item: T) {
			items.push(item);
			wake?.();
		},
		close() {
			closed = true;
			wake?.();
		},
		async *drain(): AsyncGenerator<T> {
			for (;;) {
				while (items.length > 0) yield items.shift()!;
				if (closed) return;
				await new Promise<void>((resolve) => (wake = resolve));
			}
		}
	};
}

/** What a call used when the host never said: about 3 characters to a token, in and out. */
const estimate = (messages: readonly Message[], written: string): number =>
	Math.ceil((messages.reduce((sum, m) => sum + m.content.length, 0) + written.length) / 3);

interface Slot {
	/** Where the line stood among the lines of the answer. */
	slot: number;
	raw: string;
	why: string;
}

export async function* outlineEvents(
	request: OutlineRequest,
	stream: Stream,
	/** Told what each call used, however it ended; a cut stream is estimated from what arrived. */
	spent: (tokens: number) => void = () => {},
	signal?: AbortSignal
): AsyncGenerator<OutlineEvent> {
	const messages: Message[] = [{ role: 'system', content: OUTLINE_SYSTEM_PROMPT }];
	if (request.context.trim() !== '')
		messages.push({
			role: 'user',
			content: `Course dossier (read-only background):\n\n${request.context}`
		});
	messages.push({ role: 'user', content: outlineMessage(request) });

	let outline: Outline | null = null;
	let sent = 0;
	let reason = '';
	/** The slots that have a line on the teacher's screen, in order. */
	const present: number[] = [];
	/** Lines still to be asked for again. */
	let pending: Slot[] = [];
	let slots = 0;

	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		// After a good first round only the bad lines are asked for; before that, everything.
		const retry = attempt > 0 && outline !== null && pending.length > 0;
		const asked = retry ? pending : [];
		/** What each line of a retry came to, in the order the model wrote them. */
		const results: ({ event: OutlineEvent } | { problem: string })[] = [];
		const fresh: Slot[] = [];
		let scopeFault = '';
		let whole = '';
		if (!retry) {
			slots = 0;
			pending = [];
			present.length = 0;
		}
		const out = channel<OutlineEvent>();
		const splitter = lineSplitter(
			(json, raw) => {
				const read = readLine(json);
				if ('problem' in read) {
					if (retry) results.push({ problem: read.problem });
					else fresh.push({ slot: slots++, raw, why: read.problem });
					return;
				}
				const event = read.event;
				if (event.type === 'scope') {
					// On a second round the scope is settled and not asked for again.
					if (retry || outline !== null) return;
					const fault = scopeProblem(request, event.scope);
					if (fault !== undefined) return void (scopeFault = fault);
					outline = applyEvent(outline, event);
					return void out.push(event);
				}
				if (retry) return void results.push({ event });
				// A model that forgets the scope line: the line's shape says which it is.
				if (outline === null) {
					if (scopeFault !== '') return;
					const scope = event.type === 'lesson' ? 'lessons' : 'cards';
					const fault = scopeProblem(request, scope);
					if (fault !== undefined) return void (scopeFault = fault);
					outline = applyEvent(outline, { type: 'scope', scope });
					out.push({ type: 'scope', scope });
				}
				if (scopeFault !== '') return;
				present.push(slots++);
				outline = applyEvent(outline, event);
				out.push(event);
				sent++;
			},
			(raw) => {
				if (retry) results.push({ problem: 'not valid JSON' });
				else fresh.push({ slot: slots++, raw, why: 'not valid JSON' });
			}
		);
		let counted = false;
		try {
			const run = stream(
				messages,
				(piece) => {
					whole += piece;
					splitter.feed(piece);
				},
				signal
			)
				.then(({ tokens }) => {
					counted = true;
					spent(tokens);
					splitter.end();
				})
				.finally(() => out.close());
			const done = run.then(
				() => undefined,
				(error: unknown) => ({ error })
			);
			for await (const event of out.drain()) yield event;
			const failure = await done;
			if (failure !== undefined) throw failure.error;
		} finally {
			// A call that was cut, failed or abandoned still used what it used.
			if (!counted) spent(estimate(messages, whole));
		}

		let next = '';
		const mended: OutlineEvent[] = [];
		if (retry) {
			// Only the lines that were asked for count: an answer with more lines is the whole
			// proposal again, and taking it would repeat what the teacher already has.
			const lines = results.length;
			if (lines > asked.length) {
				next = `You gave ${lines} lines, but only ${asked.length} were asked for. Answer again with only corrected versions of exactly those lines, no others.`;
			} else {
				// The i-th line stands for the i-th asked-for one and goes back to its place.
				const left: Slot[] = [];
				asked.forEach((line, i) => {
					const result = results[i];
					const fixed = result !== undefined && 'event' in result ? result.event : undefined;
					if (fixed === undefined || (fixed.type !== 'lesson' && fixed.type !== 'card')) {
						left.push({
							...line,
							why: result !== undefined && 'problem' in result ? result.problem : line.why
						});
						return;
					}
					const at = present.filter((slot) => slot < line.slot).length;
					present.splice(at, 0, line.slot);
					const event = { ...fixed, at };
					outline = applyEvent(outline, event);
					mended.push(event);
					sent++;
				});
				pending = left;
			}
		} else {
			pending = fresh;
		}
		for (const event of mended) yield event;

		if (next === '') {
			if (scopeFault !== '') next = `${scopeFault} Answer again with the whole proposal.`;
			else if (pending.length > 0)
				next = `These lines were not usable:\n${pending
					.map((b) => `${b.raw.slice(0, 120)}\n  → ${b.why}`)
					.join(
						'\n'
					)}\nAnswer again with only corrected versions of exactly these lines, in the same format, with no scope line.`;
			else if (outline === null || sent === 0)
				next = 'Your answer had no lines in the format. Answer again with the whole proposal.';
		}
		reason = next;
		if (reason === '') break;
		messages.push({ role: 'assistant', content: whole }, { role: 'user', content: reason });
	}

	const complete = outline !== null && sent > 0 ? outlineSchema.safeParse(outline) : undefined;
	// What the operator needs to see why; never the course's text or the teacher's prompt.
	if (reason !== '')
		console.error(
			'[ai] outline: lines left out after',
			ATTEMPTS,
			'attempts:',
			reason.split('\n')[0],
			{
				changing: request.current !== undefined,
				promptChars: request.prompt.length,
				contextChars: request.context.length,
				sent
			}
		);
	// Lines that were good were sent; the proposal is usable when there are some.
	yield complete?.success ? { type: 'done' } : { type: 'failed' };
}
