import { describe, expect, it, vi } from 'vitest';
import { assignSources, sourcesMessage } from '../sources';
import { fakeComplete } from '../fake';
import { textOf } from '../provider';
import type { SourcesRequest } from '$lib/domain/source-assign';

const request: SourcesRequest = {
	schema: 'eduai.sources-request/1',
	course: { title: 'Zlomky', language: 'cs' },
	cards: [
		{ id: '1', kind: 'display', name: 'Co je půlka', lesson: 'Polovina' },
		{ id: '2', kind: 'exercise', name: 'Příklady', lesson: 'Polovina' }
	],
	materials: '- [abcdef01.0] Učebnice — Úvod\n- [abcdef01.1] Učebnice — Polovina',
	material_keys: ['abcdef01.0', 'abcdef01.1']
};

describe('assignSources', () => {
	it('sends the index, then the cards without the materials, and drops made-up keys', async () => {
		const seen: string[][] = [];
		const spent = vi.fn();
		const result = await assignSources(
			request,
			async (messages) => {
				seen.push(messages.map((m) => textOf(m.content)));
				return fakeComplete(messages);
			},
			spent
		);
		expect(seen[0][1]).toContain('[abcdef01.1]');
		expect(seen[0][2]).toBe(sourcesMessage(request));
		expect(JSON.parse(seen[0][2])).not.toHaveProperty('materials');
		expect(result).toEqual([
			{ id: '1', sources: ['abcdef01.0'] },
			{ id: '2', sources: ['abcdef01.1'] }
		]);
		expect(spent).toHaveBeenCalledTimes(1);
	});

	it('asks once more for an answer that is not JSON, then gives up with nothing', async () => {
		const complete = vi
			.fn()
			.mockResolvedValueOnce({ text: 'nevím', tokens: 5 })
			.mockResolvedValueOnce({
				text: '{"cards":[{"id":"2","sources":["abcdef01.0"]}]}',
				tokens: 5
			});
		expect(await assignSources(request, complete)).toEqual([{ id: '2', sources: ['abcdef01.0'] }]);
		const never = vi.fn().mockResolvedValue({ text: 'nevím', tokens: 5 });
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await assignSources(request, never)).toEqual([]);
		expect(never).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});
});
