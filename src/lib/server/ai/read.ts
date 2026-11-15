/**
 * Reading one picture of a teacher's material (a scanned page, a photo of a sheet, a
 * slide that is only a picture) into Markdown for the materials (`domain/materials.ts`).
 */
import type { Picture, Vision } from './provider';

/** A page rendered for reading is well under this; a phone photo is shrunk first. */
export const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

/**
 * What a reading counts against the day's budget when the host did not say what it used:
 * a page picture is some 1,500 tokens in, and a page of text out.
 */
export const ESTIMATED_READ_TOKENS = 2500;

export const READ_PROMPT = `You transcribe one picture of a school teaching material (a scanned or photographed page, a worksheet, a slide) into Markdown, in the language of the picture (usually Czech).

- Write only the transcription: no comment, no greeting, no code fence around it.
- Keep the structure: headings as #, lists as lists, tables as Markdown tables, tasks in their order and with their numbers.
- Handwriting is transcribed like print. A word you cannot read is written as [nečitelné].
- Mathematics goes between dollar signs, for example $\\frac{3}{4}$, $x + 5 = 12$, $a^2$; a displayed equation between $$ and $$.
- A figure, graph, photograph or diagram that carries meaning is described in one line, in square brackets, for example [Obrázek: pravoúhlý trojúhelník se stranami 3, 4, 5]. A decoration or logo is left out.
- Do not solve, explain or correct anything. If the picture holds no readable content, answer exactly [prázdná strana].`;

/** The picture's text, or '' when the picture held nothing. */
export async function readPicture(
	vision: Vision,
	picture: Picture
): Promise<{ text: string; tokens: number }> {
	const answer = await vision(READ_PROMPT, picture);
	const text = answer.text
		.trim()
		.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/, '$1')
		.trim();
	return { text: text === '[prázdná strana]' ? '' : text, tokens: answer.tokens };
}
