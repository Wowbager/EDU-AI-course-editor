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
 * prompt, then the materials, then the dossier, then the request.
 */
import {
	applyEvent,
	cardCount,
	limitProblem,
	lineSplitter,
	outlineSchema,
	readLine,
	scopeProblem,
	type OutlineCard,
	type OutlineEvent,
	type OutlineLimits,
	type OutlineRequest,
	type Outline
} from '$lib/domain/outline';
import { MARKER_CLOSE, MARKER_OPEN } from '$lib/domain/dossier';
import { formatRules } from '$lib/ui/ai-format';
import { textOf, withPictures, type Message, type Stream } from './provider';

export const OUTLINE_SYSTEM_PROMPT = `You plan the structure of a course ("kurz") for a mobile learning app, for a teacher who will review your proposal before anything is written. A course has lessons ("lekce"); a lesson has cards ("karty"). A card is a short sequence of screens on a phone; it is written later, from its name, the outline around it and the teacher's request, so the names have to say what each card is about.

You get two or three user messages, in this order.
1. When the teacher attached materials (Word, PowerPoint, PDF, scans, pictures): their index, and when they are short enough their full text. Each section has a key in square brackets. A picture comes as the picture itself, after a line "Picture [key]:"; a card that should show it names its key in "sources". The materials are what the course is about: take its topics, order, examples and level from them, unless the teacher's prompt says otherwise.
2. The course dossier: plain text, read-only background: the course, its audience, its outline and the lessons and cards it already has. When a card is shown between the lines "${MARKER_OPEN}" and "${MARKER_CLOSE}", it is only the place the teacher is working at; it is not something to write about.
3. A JSON request: "prompt" is what the teacher asks for. "place" is where the new content goes; the teacher chose it before asking, and it decides the scope (below). "course" has the title, the language and the audience. "current", when present, is the proposal the teacher is looking at and "prompt" is what they want changed in it ("original" is what they asked for first): rework it, keep what they did not ask to change exactly as it is (names, order), and return the whole proposal again. The teacher may have written the proposal by hand: then there is no "original", and a lesson in it with no cards yet gets cards from you.

Answer in lines, one JSON object per line, and nothing else (no code fence, no commentary). The first line says what you propose and what the teacher's request limits. Its "scope" is always "place.scope":
{"scope":"lessons"} new lessons. They go after the lesson "place.after_lesson" and before "place.before_lesson" (at the start or the end of the course when one is missing); with "place.replaces_empty_lesson" they take the place of that empty lesson. One lesson is the answer to a request for some cards, a test, a revision or one lesson; several only when the prompt is about a whole course or a topic with several lessons, or says how many. Every lesson gets a short name that says its topic (never "Nová lekce" or a number);
{"scope":"cards"} cards for the lesson "place.lesson". They go between the cards "place.cards_before" (what the pupil has gone through just before) and "place.cards_after" (what comes after them). Fit them to that place: what comes before is known, what comes after is not yet. A test or practice after an explanation checks what it explained; one before it tests what the pupil brings, and does not assume the explanation.
The same line carries the request's limits, but only those the teacher's prompt sets (when it sets none, write none):
- "only": the card kinds the prompt allows, as a list, when it asks for one kind of card or a few ("a test", "just exercises", "a quiz question" ...);
- "count": the number of cards in all, when the prompt says how many ("one card", "10 questions", "three exercises").
For example {"scope":"cards","only":["question","exercise"],"count":10}. Keep to these limits in every line after it: a card of another kind or a card over the count is thrown away. With "current", the limits are those of the whole proposal as the teacher wants it now, "original" and the change together.
After it, for "lessons", one line for each lesson, in course order:
{"name":"Lesson name","cards":[{"kind":"display","name":"Card name"},{"kind":"exercise","name":"Card name"}]}
and for "cards", one line for each card:
{"kind":"exercise","name":"Card name"}
When there are materials, a card also says which sections it is written from, with "sources": a list of the keys from the materials, only keys that exist there, usually one to four, the sections that hold what this card teaches or practises:
{"kind":"display","name":"Card name","sources":["a1b2c3d4.0","a1b2c3d4.1"]}
A card that needs no material has no "sources". Keep "sources" of the cards in the proposal you are asked to rework.

A card's "kind" is
- "display": an explanation (Výklad): the pupil reads;
- "question": one quiz question or a few straight in a line (Otázka);
- "exercise": a set of practice tasks of rising difficulty (Cvičení).
A name is short, in the words a pupil or teacher would use, and never numbered ("Co je polovina", not "Karta 1"). When the teacher states a count for a card, put it in the name ("5 příkladů na sčítání"). Write nothing else about a card or lesson: no description, no goal.

Rules:
- Whose wishes count: the teacher's request first, then the materials, then these defaults. Propose exactly what was asked, nothing extra "for completeness". A test, a quiz or practice means only cards of kind "question" and "exercise", with no explanation card before them; an explanation means only "display" cards; one card means one card; a named topic means that topic only. The default shape of a lesson (below) and the rule to cover every file apply only when the teacher asks for a course or a lesson in general, without saying what it should hold.
- Language: course.language (Czech when empty). Vocabulary and ambition fit audience.grade and audience.purpose; do not plan what audience.prior_knowledge says the pupils already know, and do not repeat what the existing lessons in the dossier already teach.
- The default shape, when the request is for a whole course or lesson: build up, explain first, then practise, then check. A lesson then usually has 3 to 7 cards, mixing the three kinds with more "display" and "exercise" than "question". Any number or kind the teacher states ("lessons", "cards", "a quiz at the end") replaces this.
- With materials, take what the request needs from them, in their order. When the request is a whole course or lesson, cover what they cover: each attached file is there for a reason, so give the topic of every file at least one lesson or card, unless the prompt says to leave something out (a different grade than a file's is no reason to drop it; adapt it). When the request is narrower, use only the sections that serve it and ignore the rest. Do not plan what they do not contain. Do not invent facts, and never mention files, images or links in a name.
- At most 12 lessons and 15 cards per lesson.
${formatRules({ fields: false })}`;

const ATTEMPTS = 3;

/** What the request holds apart from the dossier and the materials, as the model's last message. */
export function outlineMessage(request: OutlineRequest): string {
	const {
		context: _context,
		materials: _materials,
		material_keys: _keys,
		pictures: _pictures,
		...rest
	} = request;
	return JSON.stringify(rest);
}

/** The label on the materials message: what they are and how to use them. */
export const MATERIALS_LABEL = `The teacher's materials (the teacher attached these files; they are the source of the topics, order, examples and wording; never mention files to the pupil):`;

/**
 * An event with only real section keys in a card's `sources`: a key the model made up is
 * dropped (the card is still good), and a card left with none has no `sources`.
 */
export function onlyKnownSources(event: OutlineEvent, keys: ReadonlySet<string>): OutlineEvent {
	const clean = (card: OutlineCard): OutlineCard => {
		const { sources, ...rest } = card;
		const known = [...new Set(sources ?? [])].filter((k) => keys.has(k));
		return known.length > 0 ? { ...rest, sources: known } : rest;
	};
	if (event.type === 'card') return { ...event, card: clean(event.card) };
	if (event.type === 'lesson')
		return { ...event, lesson: { ...event.lesson, cards: event.lesson.cards.map(clean) } };
	return event;
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
	Math.ceil((messages.reduce((sum, m) => sum + textOf(m.content).length, 0) + written.length) / 3);

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
	if (request.materials !== undefined && request.materials.trim() !== '')
		messages.push({
			role: 'user',
			content: withPictures(`${MATERIALS_LABEL}\n\n${request.materials}`, request.pictures)
		});
	if (request.context.trim() !== '')
		messages.push({
			role: 'user',
			content: `Course dossier (read-only background):\n\n${request.context}`
		});
	messages.push({ role: 'user', content: outlineMessage(request) });
	const known = new Set(request.material_keys ?? []);
	const readKnown = (json: unknown): ReturnType<typeof readLine> => {
		const read = readLine(json);
		return 'event' in read ? { event: onlyKnownSources(read.event, known) } : read;
	};

	let outline: Outline | null = null;
	let sent = 0;
	let reason = '';
	/** The slots that have a line on the teacher's screen, in order. */
	const present: number[] = [];
	/** Lines still to be asked for again. */
	let pending: Slot[] = [];
	let slots = 0;
	/** What the teacher's request limits, from the scope line (`limitProblem`). */
	let limits: OutlineLimits = {};

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
				const read = readKnown(json);
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
					// The limits are the server's: the teacher is never shown them.
					limits = {
						...(event.only ? { only: event.only } : {}),
						...(event.count ? { count: event.count } : {})
					};
					return void out.push({ type: 'scope', scope: event.scope });
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
				const broken = limitProblem(limits, outline === null ? 0 : cardCount(outline), event);
				if (broken !== undefined) {
					if (!broken.drop) fresh.push({ slot: slots++, raw, why: broken.problem });
					return;
				}
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
					// A line of the other kind is no mending: the proposal would drop it.
					const kind = outline?.scope === 'cards' ? 'card' : 'lesson';
					if (fixed === undefined || fixed.type !== kind) {
						left.push({
							...line,
							why: result !== undefined && 'problem' in result ? result.problem : line.why
						});
						return;
					}
					const broken = limitProblem(limits, outline === null ? 0 : cardCount(outline), fixed);
					if (broken !== undefined) {
						if (!broken.drop) left.push({ ...line, why: broken.problem });
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
