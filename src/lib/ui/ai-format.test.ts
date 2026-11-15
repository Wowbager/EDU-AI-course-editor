import { describe, expect, it } from 'vitest';
import { FIELDS } from './fields';
import { FORMATTED, MARKDOWN_SPECS, formatRules } from './ai-format';

describe('what the AI may write where', () => {
	it('has a rule for every field the field table says is Markdown', () => {
		const inTable = FIELDS.filter((f) => f.markdown !== undefined).map(
			(f) => `${f.level}.${f.path}`
		);
		const covered = MARKDOWN_SPECS.map((f) => `${f.level}.${f.path}`);
		// Block-level hint and help are the same field as the step's, on the card.
		const stepOf = (key: string) => key.replace(/^block\./, 'step.');
		expect(new Set(inTable.map(stepOf))).toEqual(new Set(covered));
	});

	it('follows the field table: hint and help always Markdown, solution sniffed', () => {
		const rules = formatRules().split('\n');
		const line = (key: string) => rules.find((r) => r.startsWith(`- ${key} `))!;
		expect(line('hint_md')).toMatch(/always draws it as Markdown/);
		expect(line('help_md')).toMatch(/always draws it as Markdown/);
		expect(line('solution_md')).toMatch(/when it holds a Markdown character/);
	});

	it('says plain text for the open answer, one line for an option, headings only in step text', () => {
		const rules = formatRules();
		expect(rules).toMatch(/- open answer[^\n]*plain text\. No \$/);
		expect(rules).toMatch(/- option text[^\n]*one short line[^\n]*no headings/);
		expect(rules).toMatch(/- content_md[^\n]*## headings/);
		for (const key of ['hint_md', 'help_md', 'solution_md', 'option feedback'])
			expect(rules).toMatch(new RegExp(`- ${key}[^\\n]*no headings`));
	});

	it('every field the rules name is written', () => {
		expect(
			formatRules()
				.split('\n')
				.filter((l) => l.startsWith('- ')).length
		).toBe(FORMATTED.length + 1);
		expect(formatRules({ fields: false })).toMatch(/Names of cards and lessons/);
	});
});
