/**
 * Name the sections of the teacher's materials that each of some cards is written from
 * (`domain/source-assign.ts`): the cards a teacher added to an outline by hand, when the
 * materials are too long for a card to get them all.
 *
 * Message order is for the provider's prefix cache, as in `outline.ts`: the system prompt,
 * then the materials' index, then the request.
 */
import { usableSources, type Assigned, type SourcesRequest } from '$lib/domain/source-assign';
import { parseJson } from './generate';
import type { Complete, Message } from './provider';

export const SOURCES_SYSTEM_PROMPT = `You help plan a course ("kurz") for a mobile learning app from the teacher's materials (Word, PowerPoint, PDF, scans). Each card of the course will be written later from the sections of the materials named for it; the materials are too long for a card to see them all.

You get two user messages.
1. The index of the materials: one line per section, with its key in square brackets, the file, the place in it, the title and its first words.
2. A JSON request: "course" (title and language) and "cards", each with an "id", its "kind" ("display" an explanation, "question" a quiz question, "exercise" practice tasks), its "name" and the name of its "lesson".

For each card, name the sections that hold what it teaches or practises: usually one to four, only keys from the index, in the order of the materials. A card no section is about gets an empty list.

Answer with one JSON object and nothing else:
{"cards":[{"id":"1","sources":["a1b2c3d4.0","a1b2c3d4.1"]},{"id":"2","sources":[]}]}`;

/** The label on the materials message. */
export const SOURCES_MATERIALS_LABEL = `The teacher's materials:`;

const ATTEMPTS = 2;

/** What the request holds apart from the materials, as the model's last message. */
export function sourcesMessage(request: SourcesRequest): string {
	const { materials: _materials, material_keys: _keys, schema, ...rest } = request;
	return JSON.stringify({ schema, ...rest });
}

/**
 * The sources for the request's cards, without keys the model made up. An answer that is
 * not JSON of the right shape is asked for once more; then nothing is named, and the
 * cards are written without sources.
 */
export async function assignSources(
	request: SourcesRequest,
	complete: Complete,
	/** Told what each call used as it returns. */
	spent: (tokens: number) => void = () => {}
): Promise<Assigned> {
	const messages: Message[] = [
		{ role: 'system', content: SOURCES_SYSTEM_PROMPT },
		{ role: 'user', content: `${SOURCES_MATERIALS_LABEL}\n\n${request.materials}` },
		{ role: 'user', content: sourcesMessage(request) }
	];
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const answer = await complete(messages);
		spent(answer.tokens);
		const json = parseJson(answer.text);
		if (json !== undefined && typeof json === 'object' && json !== null && 'cards' in json)
			return usableSources(request, json);
		messages.push(
			{ role: 'assistant', content: answer.text },
			{
				role: 'user',
				content: 'Your answer was not valid JSON. Answer again with one JSON object {"cards":[…]}.'
			}
		);
	}
	console.error('[ai] sources: no usable answer after', ATTEMPTS, 'attempts', {
		cards: request.cards.length
	});
	return [];
}
