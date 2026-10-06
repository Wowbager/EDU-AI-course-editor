/**
 * The agent evals: `npm run eval:agent`. See `docs/AI-SURFACE.md`, "Evals".
 *
 * Runs every scenario against the configured provider, writes `results/<time>.json`
 * and `results/latest.md` (both ignored by git), and fails if a scenario fails. Not in
 * CI and not in `npm test`: it needs a key and spends tokens.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readAiConfig, isConfigured } from '$lib/server/ai/config';
import { runScenario, type ScenarioResult } from './harness';
import { SCENARIOS } from './scenarios';

const config = readAiConfig(process.env);
const only = process.env.EVAL_ONLY?.split(',').filter(Boolean);
const results: ScenarioResult[] = [];
const dir = new URL('./results/', import.meta.url).pathname;

describe.skipIf(!isConfigured(config))('agent evals', () => {
	for (const scenario of SCENARIOS.filter((s) => !only || only.includes(s.id))) {
		it(`${scenario.id}: ${scenario.title}`, async () => {
			let result = await runScenario(scenario, config);
			// A provider hiccup is not a verdict on the agent: one more try.
			if (result.error !== undefined && result.calls.length === 0) {
				result = await runScenario(scenario, config);
			}
			results.push(result);
			const failed = result.checks.filter((c) => !c.pass);
			expect(failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`)).toEqual([]);
		});
	}

	afterAll(() => {
		if (results.length === 0) return;
		mkdirSync(dir, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const meta = { provider: config.provider, model: config.model, at: new Date().toISOString() };
		writeFileSync(`${dir}${stamp}.json`, JSON.stringify({ ...meta, results }, null, 2));
		writeFileSync(`${dir}latest.md`, summary(meta, results));
	});
});

describe.skipIf(isConfigured(config))('agent evals', () => {
	it('need AI_API_KEY (environment or .env); nothing was run', () => {
		expect(isConfigured(config)).toBe(false);
	});
});

function summary(meta: { provider: string; model: string; at: string }, rs: ScenarioResult[]) {
	const passed = rs.filter((r) => r.passed).length;
	const sum = (f: (r: ScenarioResult) => number) => rs.reduce((n, r) => n + f(r), 0);
	const lines = [
		`# Agent evals, ${meta.at}`,
		'',
		`${meta.provider} / ${meta.model}: ${passed} of ${rs.length} scenarios passed.`,
		`Tokens: ${sum((r) => r.tokens.total)} in total (${sum((r) => r.tokens.prompt)} prompt, ${sum((r) => r.tokens.completion)} completion, ${sum((r) => r.tokens.cached)} of the prompt cached); ${sum((r) => r.requests)} requests.`,
		'',
		'| Scenario | Result | Checks | Tokens | Requests | Tools called |',
		'|---|---|---|---|---|---|'
	];
	for (const r of rs) {
		const ok = r.checks.filter((c) => c.pass).length;
		lines.push(
			`| ${r.id} | ${r.passed ? 'pass' : 'FAIL'} | ${ok}/${r.checks.length} | ${r.tokens.total} | ${r.requests} | ${r.calls.length} |`
		);
	}
	const failures = rs.filter((r) => !r.passed);
	if (failures.length > 0) {
		lines.push('', '## Failed checks', '');
		for (const r of failures) {
			lines.push(`**${r.id}**`);
			for (const c of r.checks.filter((c) => !c.pass)) {
				lines.push(`- ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
			}
			lines.push('');
		}
	}
	return lines.join('\n');
}
