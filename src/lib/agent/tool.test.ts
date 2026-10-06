import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOL_SPECS, OP_NAMES } from './catalog';
import { strictViolations, toMcpDescriptor, toProviderTool } from './tool';
import { SYSTEM_PROMPT, TOOLS, TOOLS as SERVER_TOOLS } from './server-prompt';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('the catalogue', () => {
	it('has one definition per name', () => {
		const names = TOOL_SPECS.map((s) => s.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it('never offers export, publish, import, versions, visibility or mode switching', () => {
		for (const { name } of TOOL_SPECS) {
			expect(name).not.toMatch(/export|publish|import|version|visib|mode|restore/);
		}
	});

	it('asks for the revision on every write, and only a read is readOnly', () => {
		for (const spec of TOOL_SPECS) {
			const schema = z.toJSONSchema(spec.input) as { required?: string[] };
			const writes = !spec.annotations.readOnlyHint;
			expect(schema.required?.includes('expected_revision') ?? false, spec.name).toBe(writes);
			expect(spec.annotations.openWorldHint).toBe(false);
			if (spec.annotations.readOnlyHint) expect(spec.annotations.destructiveHint).toBe(false);
		}
	});

	it('names every edit operation as a batch entry and as a tool', () => {
		const batch = TOOL_SPECS.find((s) => s.name === 'apply_batch')!;
		const json = JSON.stringify(z.toJSONSchema(batch.input));
		for (const op of OP_NAMES) {
			expect(json).toContain(`"${op}"`);
			expect(TOOL_SPECS.some((s) => s.name === op)).toBe(true);
		}
		expect(json).not.toContain('"delete"');
	});
});

describe('converting a definition', () => {
	it.each(TOOL_SPECS.map((s) => [s.name, s] as const))(
		'%s becomes an MCP descriptor',
		(_n, spec) => {
			const d = toMcpDescriptor(spec);
			expect(d).toMatchObject({
				name: spec.name,
				title: spec.title,
				annotations: spec.annotations
			});
			expect(d.description.length).toBeGreaterThan(20);
			expect(d.inputSchema.type).toBe('object');
			expect(d.inputSchema).not.toHaveProperty('$schema');
			if (spec.output !== undefined) expect(d.outputSchema?.type).toBe('object');
		}
	);

	it.each(TOOL_SPECS.map((s) => [s.name, s] as const))(
		'%s is compatible with strict mode',
		(_n, spec) => {
			const tool = toProviderTool(spec);
			expect(tool.strict).toBe(true);
			expect(tool.parameters.type).toBe('object');
			expect(strictViolations(tool.parameters)).toEqual([]);
			// Every property required, nothing else allowed.
			const props = Object.keys(tool.parameters.properties as object);
			expect([...(tool.parameters.required as string[])].sort()).toEqual([...props].sort());
			expect(tool.parameters.additionalProperties).toBe(false);
		}
	);

	it('detects what strict mode would refuse', () => {
		expect(strictViolations({ type: 'object', properties: { a: { type: 'string' } } }).length).toBe(
			2
		);
		expect(strictViolations({ oneOf: [] })).toContain('$: oneOf');
	});

	it('is what the server offers the model', () => {
		expect(SERVER_TOOLS.map((t) => t.name)).toEqual(TOOL_SPECS.map((s) => s.name));
		expect(SERVER_TOOLS).toEqual(TOOL_SPECS.map(toProviderTool));
	});
});

describe('the server side', () => {
	const source = (file: string) =>
		readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

	it('imports no store, handler or context at run time', () => {
		for (const file of ['./catalog.ts', './tool.ts', './server-prompt.ts']) {
			const imports = [...source(file).matchAll(/^import (?!type)[^;]*from '([^']+)'/gm)].map(
				(m) => m[1]
			);
			for (const from of imports) {
				expect(from, `${file} imports ${from}`).not.toMatch(
					/state\/|handlers|context|simulation|card-content|\.svelte/
				);
			}
		}
	});

	it('has a fixed prompt, and names only tools that exist', () => {
		expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|\$\{/);
		const names = new Set(TOOL_SPECS.map((s) => s.name));
		const used =
			SYSTEM_PROMPT.match(
				/\b(?:get|list|simulate|explore|plan|apply|undo|revert|show|search|set|add)_[a-z_]+\b/g
			) ?? [];
		expect(used.length).toBeGreaterThan(8);
		for (const name of used) expect(names.has(name), name).toBe(true);
		expect(JSON.stringify(TOOLS)).toBe(JSON.stringify(TOOL_SPECS.map(toProviderTool)));
	});

	it('tells the model the rules the code enforces', () => {
		for (const word of [
			'expected_revision',
			'hidden_in_mode',
			'not_open',
			'simulace',
			'course_content',
			'declined',
			'revert_ai_session'
		]) {
			expect(SYSTEM_PROMPT).toContain(word);
		}
	});
});
