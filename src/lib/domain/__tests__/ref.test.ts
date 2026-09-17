import { describe, expect, it } from 'vitest';
import { jsonPathToRef, refToJsonPath, type Ref } from '../ref';

const roundTrips = (ref: Ref) => expect(jsonPathToRef(refToJsonPath(ref))).toEqual(ref);

describe('Ref ↔ JSON path', () => {
	it('addresses the course root', () => {
		expect(refToJsonPath({})).toBe('$');
		expect(refToJsonPath({ field: 'version' })).toBe('$.version');
		roundTrips({ field: 'version' });
	});

	it('addresses a lesson and a binding', () => {
		expect(refToJsonPath({ lessonId: 'L1_INTRO' })).toBe('$.lessons[lesson_id=L1_INTRO]');
		expect(refToJsonPath({ lessonId: 'L1_INTRO', blockId: 'B1', field: 'bg_color' })).toBe(
			'$.lessons[lesson_id=L1_INTRO].blocks[block_id=B1].bg_color'
		);
		roundTrips({ lessonId: 'L1_INTRO', blockId: 'B1', field: 'bg_color' });
	});

	it('addresses a block, a step and an option', () => {
		expect(refToJsonPath({ blockId: 'B1', stepId: 's2', optionId: 'a', field: 'go_to' })).toBe(
			'$.blocks[block_id=B1].steps[id=s2].question.options[id=a].go_to'
		);
		roundTrips({ blockId: 'B1' });
		roundTrips({ blockId: 'B1', stepId: 's2' });
		roundTrips({ blockId: 'B1', stepId: 's2', optionId: 'a', field: 'go_to' });
	});

	it('keeps a dotted field path intact', () => {
		expect(refToJsonPath({ blockId: 'B1', field: 'gpf.relation_vector' })).toBe(
			'$.blocks[block_id=B1].gpf.relation_vector'
		);
		roundTrips({ blockId: 'B1', field: 'gpf.relation_vector' });
	});

	it('addresses the block, not the binding, once a step is named', () => {
		// Steps live on the block definition; the lesson is only UI context there.
		expect(refToJsonPath({ lessonId: 'L1', blockId: 'B1', stepId: 's1' })).toBe(
			'$.blocks[block_id=B1].steps[id=s1]'
		);
	});

	it('survives ids containing path punctuation', () => {
		const ref: Ref = { blockId: 'B[1].odd', stepId: 's1' };
		roundTrips(ref);
	});

	it('addresses by business key, so it survives a reorder', () => {
		// Nothing in the path is an array index, which is what makes a deep link and a
		// jump-to-fix still land on the right thing after the author drags a card.
		expect(refToJsonPath({ blockId: 'B9', stepId: 's3' })).not.toMatch(/\[\d+\]/);
	});

	it('rejects a path it did not produce', () => {
		expect(() => jsonPathToRef('blocks[0].steps[1]')).toThrow();
	});
});
