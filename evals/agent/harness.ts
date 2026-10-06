/**
 * The eval harness: one scenario, run for real.
 *
 * A scenario is a course (a corpus fixture, optionally damaged on purpose), a mode, the
 * teacher's messages, how the teacher answers a confirmation, and a grader. The loop is
 * the browser's own `ChatSession`, driven over the headless context with the provider
 * adapter as its transport (`server/ai/provider.ts`), so what runs here is what runs in
 * the page apart from the HTTP hop. Everything is graded in code, never by another model.
 */
import { createHeadlessContext } from '$lib/agent/context';
import { ChatSession, ROUNDS_NOTE, type ToolRunner } from '$lib/agent/chat.svelte';
import type { Transport } from '$lib/agent/chat-transport';
import { runTool } from '$lib/agent/handlers';
import type { ConfirmRequest } from '$lib/agent/tool';
import { TOOL_SPECS } from '$lib/agent/catalog';
import { SYSTEM_PROMPT, TOOLS } from '$lib/agent/server-prompt';
import { importCourse, parseCourse, serialise } from '$lib/domain/document';
import type { CourseV2 } from '$lib/domain/schema';
import type { AiConfig } from '$lib/server/ai/config';
import { streamChat } from '$lib/server/ai/provider';
import { DocStore } from '$lib/state/doc-store.svelte';
import type { Mode } from '$lib/ui/fields';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The tools that can change the course (everything not read-only). */
export const WRITE_TOOLS = new Set(
	TOOL_SPECS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name)
);

const fixtures = fileURLToPath(
	new URL('../../src/lib/domain/__tests__/fixtures/', import.meta.url)
);

export function loadFixture(name: string): CourseV2 {
	const raw = JSON.parse(readFileSync(`${fixtures}${name}`, 'utf8'));
	return name.startsWith('corpus/') ? importCourse(raw).doc : parseCourse(raw);
}

export interface Check {
	name: string;
	pass: boolean;
	detail?: string;
}

/** Everything a grader may look at. */
export interface Outcome {
	store: DocStore;
	session: ChatSession;
	/** The course as the run began, serialised. */
	start: string;
	startErrors: number;
	startWarnings: number;
	/** The course now, serialised. */
	end: string;
	/** What the teacher was asked, in order. */
	asked: ConfirmRequest[];
	/** The assistant's words to the teacher, joined. */
	said: string;
	/** Tools called, in order, with how each ended. */
	calls: ChatSession['toolCalls'];
	doc: CourseV2;
	/** Whether the teacher's mid-run edit happened. */
	edited: boolean;
}

export interface Scenario {
	id: string;
	title: string;
	fixture: string;
	mode?: Mode;
	showFeedback?: boolean;
	/** Change the course before the run (a damaged copy). The start state includes it. */
	prepare?: (doc: CourseV2) => CourseV2;
	/** The teacher's messages, sent one after the other. */
	prompts: (store: DocStore) => string[];
	/** The teacher's answer to every question. */
	confirm: 'approve' | 'decline';
	/**
	 * A teacher's own edit that lands after the AI's last read and before its first write:
	 * the write must then be refused as stale and the AI has to read again.
	 */
	teacherEdit?: (store: DocStore) => void;
	grade: (o: Outcome) => Check[];
}

export interface ScenarioResult {
	id: string;
	title: string;
	passed: boolean;
	checks: Check[];
	tokens: { prompt: number; completion: number; total: number; cached: number };
	requests: number;
	calls: { name: string; ok: boolean; error?: string }[];
	asked: string[];
	said: string;
	seconds: number;
	error?: string;
}

/** Every id the course carries: what the teacher must never be told. */
function idsOf(doc: CourseV2): string[] {
	const ids = new Set<string>([doc.course_id]);
	for (const lesson of doc.lessons) ids.add(lesson.lesson_id);
	for (const block of doc.blocks) {
		ids.add(block.block_id);
		for (const step of block.steps) {
			ids.add(step.id);
			for (const option of step.question?.options ?? []) ids.add(option.id);
		}
	}
	return [...ids].filter((id) => id.length >= 3 && /[_\d]/.test(id));
}

/** The words of the assistant that name an id, a path or a tool argument. */
export function leaks(text: string, doc: CourseV2): string[] {
	const found = new Set<string>();
	for (const id of idsOf(doc)) if (text.includes(id)) found.add(id);
	for (const m of text.matchAll(
		/\$\.(?:blocks|lessons)\[|\b(?:block_id|lesson_id|expected_revision|course_id)\b/g
	))
		found.add(m[0]);
	return [...found];
}

export function transportFor(config: AiConfig): Transport {
	return (messages, signal) =>
		streamChat({ system: SYSTEM_PROMPT, tools: TOOLS, messages, signal }, config);
}

export async function runScenario(
	scenario: Scenario,
	config: AiConfig,
	transport: Transport = transportFor(config)
): Promise<ScenarioResult> {
	const t0 = Date.now();
	const store = new DocStore();
	const base = loadFixture(scenario.fixture);
	store.load(scenario.prepare ? scenario.prepare(structuredClone(base)) : base);
	store.splitQuestions();
	store.mode = scenario.mode ?? 'teacher';
	store.showFeedback = scenario.showFeedback ?? true;

	const start = JSON.stringify(serialise(store.source));
	const startDoc = structuredClone(store.doc);
	const startErrors = store.validation.errors.length;
	const startWarnings = store.validation.warnings.length;
	const asked: ConfirmRequest[] = [];
	const ctx = createHeadlessContext(store, {
		confirm: (request) => {
			asked.push(request);
			return scenario.confirm === 'approve';
		}
	});
	let edited = false;
	const run: ToolRunner = async (name, args, c) => {
		if (!edited && scenario.teacherEdit && WRITE_TOOLS.has(name)) {
			edited = true;
			scenario.teacherEdit(store);
		}
		return runTool(name, args, c);
	};
	const session = new ChatSession({ store, ctx, transport, run });
	for (const prompt of scenario.prompts(store)) await session.send(prompt);

	const lines = store.ai.lines;
	const errorLine = lines.find((l) => l.role === 'error');
	const said = lines
		.filter((l) => l.role === 'assistant')
		.map((l) => l.text)
		.join('\n');
	const outcome: Outcome = {
		store,
		session,
		start,
		startErrors,
		startWarnings,
		end: JSON.stringify(serialise(store.source)),
		asked,
		said,
		calls: session.toolCalls,
		doc: store.doc,
		edited
	};

	const checks: Check[] = [];
	if (errorLine !== undefined) {
		checks.push({ name: 'the provider answered', pass: false, detail: errorLine.text });
	}
	checks.push(
		{
			name: 'stayed inside the round limit',
			pass: !lines.some((l) => l.text === ROUNDS_NOTE)
		},
		{
			name: 'no id, path or argument name in what the teacher is told',
			pass: leaks(said, startDoc).length === 0,
			detail: leaks(said, startDoc).join(', ')
		},
		{ name: 'said something', pass: said.trim().length > 0 }
	);
	checks.push(...scenario.grade(outcome));

	// Whatever the AI did, one revert gives the start back, byte for byte.
	const changed = store.aiActions.length > 0 || outcome.end !== start;
	if (changed) {
		store.revertAiSession();
		const back = JSON.stringify(serialise(store.source));
		checks.push({
			name: 'revert_ai_session restores the start',
			pass: back === start,
			detail: back === start ? undefined : 'the course differs from the start after the revert'
		});
	}

	const u = session.usage;
	return {
		id: scenario.id,
		title: scenario.title,
		passed: checks.every((c) => c.pass),
		checks,
		tokens: {
			prompt: u.promptTokens,
			completion: u.completionTokens,
			total: u.totalTokens,
			cached: u.cachedTokens ?? 0
		},
		requests: session.requests,
		calls: session.toolCalls.map(({ name, ok, error }) => ({
			name,
			ok,
			...(error ? { error } : {})
		})),
		asked: asked.map((a) => `${a.title}: ${a.items.join(' | ')}`),
		said,
		seconds: Math.round((Date.now() - t0) / 100) / 10,
		...(errorLine ? { error: errorLine.text } : {})
	};
}
