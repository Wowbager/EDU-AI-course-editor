import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ALWAYS_MARKDOWN,
	INLINE,
	SNIFFED,
	canEditVisually,
	parseMarkdown,
	serializeMarkdown,
	type MarkdownDialect
} from '../index';

const corpusDir = fileURLToPath(new URL('../../__tests__/fixtures/corpus', import.meta.url));

/** The Markdown + LaTeX fields of every course in the corpus, with the app's reading of each. */
function corpusTexts(): { key: string; text: string; dialect: MarkdownDialect }[] {
	const found: { key: string; text: string; dialect: MarkdownDialect }[] = [];
	const walk = (node: unknown, key?: string) => {
		if (typeof node === 'string') {
			const dialect =
				key === 'hint' || key === 'help'
					? ALWAYS_MARKDOWN
					: key === 'text'
						? INLINE
						: key === 'content' || key === 'solution' || key === 'feedback'
							? SNIFFED
							: null;
			if (dialect && node.trim() !== '') found.push({ key: key!, text: node, dialect });
		} else if (node && typeof node === 'object') {
			for (const [k, v] of Object.entries(node)) walk(v, Array.isArray(node) ? key : k);
		}
	};
	for (const file of readdirSync(corpusDir).filter((f) => f.endsWith('.json')))
		walk(JSON.parse(readFileSync(`${corpusDir}/${file}`, 'utf8')));
	return found;
}

describe('the corpus in the visual editor', () => {
	const texts = corpusTexts();
	const html = texts.filter((t) => /<\/?[a-z][^>]*>/i.test(t.text));
	const markdown = texts.filter((t) => !html.includes(t));

	it('has texts of both kinds to check', () => {
		expect(markdown.length).toBeGreaterThan(300);
		expect(html.length).toBeGreaterThan(5);
	});

	it('opens every Markdown text visually', () => {
		expect(markdown.filter((t) => !canEditVisually(t.text, t.dialect)).map((t) => t.text)).toEqual(
			[]
		);
	});

	it('never opens legacy HTML visually, so it is never rewritten', () => {
		expect(html.filter((t) => canEditVisually(t.text, t.dialect)).map((t) => t.text)).toEqual([]);
	});

	it('writes each text the same way twice (normalising once, not on every edit)', () => {
		const unstable = markdown.filter((t) => {
			const once = serializeMarkdown(parseMarkdown(t.text, t.dialect).doc, t.dialect);
			const twice = serializeMarkdown(parseMarkdown(once, t.dialect).doc, t.dialect);
			return once !== twice;
		});
		expect(unstable.map((t) => t.text)).toEqual([]);
	});
});
