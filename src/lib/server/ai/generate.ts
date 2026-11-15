/**
 * Write one card: ask the model for the slots that are empty, and accept only an
 * answer that is valid JSON of the right shape, covers every slot asked for and
 * nothing else.
 *
 * Two things here do not rely on the model behaving:
 *  - what the teacher wrote is sent as context and never comes back from here: the
 *    answer is cut down to the slots that were asked for (`restrictGenerated`);
 *  - the number of right answers is counted, not believed (`questionIsSound`).
 * An answer that fails is sent back with the reason, twice at most; then the card is
 * reported as failed and nothing is written.
 */
import {
	generatedSchema,
	questionIsSound,
	restrictGenerated,
	unanswered,
	type GenRequest,
	type Generated
} from '$lib/domain/authoring';
import type { Complete, Message } from './provider';

export type GenResponse =
	{ status: 'ok'; block: Generated } | { status: 'failed'; block: Record<string, never> };

/** Bump when the rules below change what a card should say; later it keys the cache. */
export const SPEC_VERSION = '1';

export const SYSTEM_PROMPT = `You write one learning card ("blok") for a mobile learning app. A card is one step of learning on one phone screen: either an explanation ("display"), or an exercise ("exercise") with a question.

You get a JSON request: the course and its audience, the lesson with the titles of its other cards, and the card: its title, an optional brief, the parts the teacher already wrote ("given") and the list of parts that are still empty ("missing"). Write ONLY the missing parts, so that they fit what is given. Never rewrite or repeat a given part.

Answer with one JSON object and nothing else. Keys, each only when its part is in "missing":
- "content" → "content_md": the card's text; for an exercise, the task the pupil reads.
- "question" → "question": one of
  {"type":"yes_no","answer":true|false,"feedback_true":"…","feedback_false":"…"}
  {"type":"number","answer":<number>,"tolerance":<number, 0 when exact>}
  {"type":"mcq_1","options":[{"text":"…","correct":true|false,"feedback":"…"}]}  exactly one correct, 3–4 options
  {"type":"mcq_n","options":[…]}  at least two correct and at least one wrong, 4–6 options; the task must say that several answers are right
  {"type":"open","answer":"model answer; for 'explain in your own words' list the points that must not be missing"}
  When the request gives "question_type", use exactly that type. Otherwise choose the type that suits the task.
- "feedback" → "option_feedback": an array with one reaction for each option in given.question.options, in the same order.
- "hint" → "hint_md", "help" → "help_md", "solution" → "solution_md".

Rules for what you write:
- Language: course.language. Address, sentence length and emoji follow audience.register; when it is empty and the language is Czech, use informal "ty", short sentences and emoji sparingly. Vocabulary fits audience.grade. Do not explain again what audience.prior_knowledge says the pupil already knows.
- audience.purpose: "intro" is a first explanation, "practice" is practising, "exam_prep" is preparing for an exam; it sets the style and how demanding the question is.
- Length: content_md has 20 to 80 visible words; closer to 20 for younger pupils.
- One card carries one idea. Do not repeat what the neighbouring cards are about.
- An exercise must be solvable from the lesson's earlier cards and the prior knowledge.
- For yes_no the statement in the task is clearly true or clearly false. For number, the unit belongs in the task, not in the answer.
- hint_md is a nudge: it shows where to look. It must not contain the answer or determine it.
- help_md is a rescue: it may lead the pupil to the answer, typically by the rule the task is about.
- solution_md says the correct answer and, mainly, why. It does not start with a heading such as "Vysvětlení:"; the app draws that.
- Hint, help and solution do three different jobs. They are not three versions of the same text.
- A wrong option is a mistake pupils really make, or a neighbouring concept; never nonsense, and never also correct.
- Feedback on a wrong option explains why it does not hold; "Špatně." is not enough. For a correct option short praise is enough.
- Maths goes between dollar signs, for example $\\frac{1}{2}$. Text is Markdown: bold, italics, lists; an empty line starts a new paragraph.
- Do not invent facts beyond common school knowledge of the topic, and never mention files, images or links.`;

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
function problemWith(request: GenRequest, raw: string): { use: Generated } | { say: string } {
	const parsed = generatedSchema.safeParse(parseJson(raw));
	if (!parsed.success)
		return {
			say: `Your answer was not a valid object: ${parsed.error.issues
				.slice(0, 5)
				.map((i) => `${i.path.join('.')}: ${i.message}`)
				.join('; ')}. Answer again with one JSON object.`
		};
	const block = restrictGenerated(request, parsed.data);
	if (
		request.block.missing.includes('question') &&
		parsed.data.question !== undefined &&
		block.question === undefined
	)
		return { say: `Use the question type "${request.block.question_type}". Answer again.` };
	if (block.question !== undefined && !questionIsSound(block.question))
		return {
			say: 'The number of correct options does not fit the question type (mcq_1: exactly one; mcq_n: at least two, and at least one wrong). Answer again.'
		};
	const given = request.block.given.question as { options?: unknown[] } | undefined;
	if (
		block.option_feedback !== undefined &&
		block.option_feedback.length !== (given?.options?.length ?? 0)
	)
		return { say: 'option_feedback must have exactly one text per given option. Answer again.' };
	const left = unanswered(request, block);
	if (left.length > 0)
		return {
			say: `These parts are missing from your answer: ${left.join(', ')}. Answer again with all missing parts.`
		};
	return { use: block };
}

export async function generateBlock(
	request: GenRequest,
	complete: Complete,
	/** Told what each call used as it returns, so a later failure does not lose the count. */
	spent: (tokens: number) => void = () => {}
): Promise<{ response: GenResponse; tokens: number }> {
	const messages: Message[] = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: JSON.stringify(request) }
	];
	let tokens = 0;
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const answer = await complete(messages);
		tokens += answer.tokens;
		spent(answer.tokens);
		const verdict = problemWith(request, answer.text);
		if ('use' in verdict) return { response: { status: 'ok', block: verdict.use }, tokens };
		messages.push(
			{ role: 'assistant', content: answer.text },
			{ role: 'user', content: verdict.say }
		);
	}
	return { response: { status: 'failed', block: {} }, tokens };
}
