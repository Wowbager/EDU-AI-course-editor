/**
 * What a tool is, in one place: a name, a Czech description, a zod schema for what goes
 * in and (optionally) what comes out, the MCP annotations that say what it may do, a
 * `confirm` that decides when the teacher is asked first, and the code that runs it.
 *
 * One definition feeds three readers: the model (`toProviderTool`, an OpenAI-style
 * strict function), an MCP client (`toMcpDescriptor`), and the executor
 * (`executeTool`), which is the only way a tool runs — parse, check the revision, ask,
 * run — and which never throws: a tool answers `{ok: true, data, text}` or
 * `{ok: false, error: {code, message}}`, `message` in Czech and meant for the model to
 * relay.
 *
 * Headless and importable on the server: nothing here touches a store. The code that
 * runs a tool (`handlers.ts`) is attached to a definition (`catalog.ts`) separately,
 * so the server can list the tools without loading the editor.
 */
import { z } from 'zod';
import { CommandError } from '$lib/domain/commands';
import type { ToolDefinition } from './server-prompt';
import type { AgentContext } from './context';

/** What a client may assume about a tool (MCP `ToolAnnotations`). */
export interface ToolAnnotations {
	/** Changes nothing in the course. */
	readOnlyHint: boolean;
	/** May delete or overwrite what is there. Always asks the teacher first. */
	destructiveHint: boolean;
	/** The same call twice leaves the course as one call does. */
	idempotentHint: boolean;
	/** Never reaches outside the editor. */
	openWorldHint: false;
}

export type ToolErrorCode =
	| 'bad_arguments'
	| 'stale'
	| 'declined'
	| 'mode'
	| 'refused'
	| 'not_found'
	| 'bad_path'
	| 'too_large'
	| 'no_session'
	| 'unknown_tool'
	| 'internal';

export interface ToolError {
	code: ToolErrorCode;
	/** Czech, for the model to read and, where it helps, to relay. */
	message: string;
	details?: unknown;
}

export type ToolResult<T = unknown> =
	{ ok: true; data: T; text: string } | { ok: false; error: ToolError };

/** A failure a tool raises from anywhere inside its code; `executeTool` turns it into a result. */
export class ToolFailure extends Error {
	constructor(
		readonly code: ToolErrorCode,
		message: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = 'ToolFailure';
	}
}

export const fail = (
	code: ToolErrorCode,
	message: string,
	details?: unknown
): ToolResult<never> => ({
	ok: false,
	error: details === undefined ? { code, message } : { code, message, details }
});

export const succeed = <T>(data: T, text: string): ToolResult<T> => ({ ok: true, data, text });

/** What the teacher is asked before a tool runs. Czech throughout. */
export interface ConfirmRequest {
	title: string;
	message: string;
	/** One line per thing that will happen: the descriptions and where. */
	items: string[];
	destructive: boolean;
}

/** The definition, without the code that runs it: all the server needs. */
export interface ToolSpec<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
	name: string;
	/** Short Czech name for the action log and the confirmation. */
	title: string;
	/** For the model: what it does, when to use it, what it returns. Czech-friendly, precise. */
	description: string;
	input: I;
	output?: O;
	annotations: ToolAnnotations;
}

export interface ToolImpl<I extends z.ZodType = z.ZodType> {
	/**
	 * Refuses before anything is asked or changed: a mode that does not show the field,
	 * an id, a path that is nothing. Runs after the revision check.
	 */
	guard?(input: z.infer<I>, ctx: AgentContext): ToolResult<never> | undefined;
	/** When the teacher is asked first. A `destructiveHint` tool must always return one. */
	confirm?(input: z.infer<I>, ctx: AgentContext): ConfirmRequest | undefined;
	run(input: z.infer<I>, ctx: AgentContext): ToolResult | Promise<ToolResult>;
}

export interface Tool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType>
	extends ToolSpec<I, O>, ToolImpl<I> {}

/** A definition with its annotations only; `implement` gives it code. */
export function defineSpec<I extends z.ZodType, O extends z.ZodType = z.ZodType>(
	spec: ToolSpec<I, O>
): ToolSpec<I, O> {
	return spec;
}

/** One-step form: a definition and its code together. */
export function defineTool<I extends z.ZodType, O extends z.ZodType = z.ZodType>(
	tool: Tool<I, O>
): Tool<I, O> {
	return tool;
}

export function implement<I extends z.ZodType, O extends z.ZodType>(
	spec: ToolSpec<I, O>,
	impl: ToolImpl<I>
): Tool<I, O> {
	return { ...spec, ...impl };
}

// ───────────────────────────────────── converters ─────────────────────────────────────

export interface McpToolDescriptor {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations: ToolAnnotations;
}

type Json = Record<string, unknown>;

const jsonSchemaOf = (schema: z.ZodType): Json => {
	const { $schema: _dialect, ...rest } = z.toJSONSchema(schema) as Json;
	return rest;
};

/** The MCP `tools/list` entry for a tool. */
export function toMcpDescriptor(tool: ToolSpec): McpToolDescriptor {
	return {
		name: tool.name,
		title: tool.title,
		description: tool.description,
		inputSchema: jsonSchemaOf(tool.input),
		...(tool.output === undefined ? {} : { outputSchema: jsonSchemaOf(tool.output) }),
		annotations: tool.annotations
	};
}

/**
 * What a provider's strict mode accepts: `anyOf` for unions (not `oneOf`), `enum` for a
 * constant, and none of the value limits (`maxLength`, `minimum`, …), which it rejects.
 * The limits are not lost: `executeTool` parses the arguments with the full schema and
 * answers a failure in Czech.
 */
const LIMITS = [
	'minLength',
	'maxLength',
	'pattern',
	'format',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'multipleOf',
	'minItems',
	'maxItems',
	'uniqueItems',
	'default'
];

function strictify(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(strictify);
	if (typeof node !== 'object' || node === null) return node;
	const out: Json = {};
	// An object with no properties still lists them: strict mode wants `required` always.
	if ('properties' in node && !('required' in node)) out.required = [];
	for (const [key, value] of Object.entries(node)) {
		if (LIMITS.includes(key) && typeof value !== 'object') continue;
		if (key === 'oneOf') out.anyOf = strictify(value);
		else if (key === 'const') out.enum = [value];
		else out[key] = strictify(value);
	}
	return out;
}

/** Why a schema would be refused by strict mode: `[]` when it would not. */
export function strictViolations(schema: unknown, path = '$'): string[] {
	if (Array.isArray(schema)) return schema.flatMap((s, i) => strictViolations(s, `${path}[${i}]`));
	if (typeof schema !== 'object' || schema === null) return [];
	const node = schema as Json;
	const problems: string[] = [];
	if (node.properties !== undefined) {
		const names = Object.keys(node.properties as Json);
		if (node.additionalProperties !== false)
			problems.push(`${path}: additionalProperties is not false`);
		const required = (node.required as string[] | undefined) ?? [];
		for (const name of names)
			if (!required.includes(name)) problems.push(`${path}.${name}: not required`);
	}
	if (node.type === 'object' && node.properties === undefined)
		problems.push(`${path}: an object with no declared properties`);
	for (const key of ['oneOf', 'allOf', 'not', '$ref', 'patternProperties'])
		if (key in node) problems.push(`${path}: ${key}`);
	for (const key of LIMITS)
		if (key in node && typeof node[key] !== 'object') problems.push(`${path}: ${key}`);
	for (const [key, value] of Object.entries(node))
		if (typeof value === 'object') problems.push(...strictViolations(value, `${path}.${key}`));
	return problems;
}

/** The function the provider is offered: strict, every property required. */
export function toProviderTool(tool: ToolSpec): ToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		parameters: strictify(jsonSchemaOf(tool.input)) as Record<string, unknown>,
		strict: true
	};
}

// ────────────────────────────────────── executor ──────────────────────────────────────

const issuesText = (error: z.ZodError): string =>
	error.issues
		.slice(0, 5)
		.map((i) => `${i.path.length > 0 ? i.path.join('.') : 'argumenty'}: ${i.message}`)
		.join('; ');

/**
 * Run a tool the one way it may run. `args` is the model's raw JSON text or an already
 * parsed value. Order: parse, the revision of a write (`expected_revision`, a stale one
 * changes nothing), the tool's own `guard`, the teacher's confirmation, the code. Never
 * throws.
 */
export async function executeTool(
	tool: Tool,
	args: unknown,
	ctx: AgentContext
): Promise<ToolResult> {
	let raw = args;
	if (typeof args === 'string') {
		try {
			raw = args.trim() === '' ? {} : JSON.parse(args);
		} catch {
			return fail('bad_arguments', 'Argumenty nejsou platný JSON.');
		}
	}
	const parsed = tool.input.safeParse(raw);
	if (!parsed.success) {
		return fail('bad_arguments', `Neplatné argumenty: ${issuesText(parsed.error)}`);
	}
	const input = parsed.data as Record<string, unknown>;
	try {
		if (!tool.annotations.readOnlyHint && typeof input.expected_revision === 'number') {
			if (input.expected_revision !== ctx.revision) {
				return fail(
					'stale',
					`Kurz se od tvého posledního čtení změnil (verze ${ctx.revision}, ty znáš ${input.expected_revision}). Nic se neprovedlo; načti znovu, co potřebuješ, a zkus to s novou verzí.`,
					{ revision: ctx.revision }
				);
			}
		}
		const refused = tool.guard?.(input, ctx);
		if (refused !== undefined) return refused;
		const request = tool.confirm?.(input, ctx);
		if (tool.annotations.destructiveHint && request === undefined) {
			return fail('internal', 'Nástroj označený jako destruktivní nemá potvrzení.');
		}
		if (request !== undefined && !(await ctx.confirm(request))) {
			return fail(
				'declined',
				'Učitel změnu nepotvrdil. Nic se nezměnilo; zeptej se, co chce místo toho.'
			);
		}
		return await tool.run(input, ctx);
	} catch (error) {
		if (error instanceof ToolFailure) return fail(error.code, error.message, error.details);
		if (error instanceof CommandError) return fail('refused', error.message);
		return fail(
			'internal',
			'Nástroj selhal. Nic se nezměnilo; zkus to znovu nebo to řekni učiteli.'
		);
	}
}
