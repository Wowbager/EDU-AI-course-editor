import { describe, expect, it } from 'vitest';
import { overlayOpen } from './overlay';

describe('overlayOpen', () => {
	it('asks for an open dialog or popover', () => {
		let asked = '';
		const root = {
			querySelector: (selector: string) => {
				asked = selector;
				return {} as Element;
			}
		};
		expect(overlayOpen(root)).toBe(true);
		expect(asked).toContain('dialog[open]');
		expect(asked).toContain(':popover-open');
		expect(overlayOpen({ querySelector: () => null })).toBe(false);
	});
});
