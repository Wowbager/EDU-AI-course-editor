import { describe, expect, it } from 'vitest';
import { uniqueKeys } from '$lib/ui/keys';

describe('keys for a list that may hold duplicate ids', () => {
	it('are the ids themselves when the ids are unique', () => {
		expect(uniqueKeys(['s1', 's2', 's3'])).toEqual(['s1', 's2', 's3']);
	});
	it('stay unique when they are not', () => {
		const keys = uniqueKeys(['s1', 's2', 's1', 's1']);
		expect(keys).toEqual(['s1', 's2', 's1#2', 's1#3']);
		expect(new Set(keys).size).toBe(keys.length);
	});
	it('cannot collide with an id that already looks like a suffixed key', () => {
		// `s1#2` as a real id, then a second `s1`: the generated key must not repeat it.
		const keys = uniqueKeys(['s1#2', 's1', 's1']);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
