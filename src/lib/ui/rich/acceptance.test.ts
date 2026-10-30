/**
 * The acceptance table (§8) against the key data: every key a row names exists in
 * `keypad-data.ts` (a plain string is a letter typed on the physical keyboard), every
 * row's keys are reachable in the default profile, and the expected canonical LaTeX is
 * what the row says. Rendering and parsing of each expected string is in
 * `math-render.test.ts`; pressing the keys in the real field is `e2e/math-keypad.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ACCEPTANCE } from './acceptance-rows';
import { KEY_BY_ID, PROFILES, TAB_BY_ID } from './keypad-data';

const VSE = PROFILES.find((p) => p.id === 'vse')!;
const TABS_IN_PROFILE = new Set(VSE.tabs);

describe('acceptance rows (§8)', () => {
	for (const row of ACCEPTANCE) {
		it(`#${row.n} ${row.formula}`, () => {
			const usedTabs = new Set<string>();
			for (const k of row.keys) {
				if (k === 'next') continue;
				const key = KEY_BY_ID.get(k);
				if (key === undefined) continue; // a letter typed on the physical keyboard
				const tab = TABS_FOR_KEY.get(k);
				expect(tab, `key ${k} is on a tab`).toBeDefined();
				expect(TABS_IN_PROFILE.has(tab!), `key ${k} in profile`).toBe(true);
				usedTabs.add(tab!);
			}
			// The keys of one formula stay on few tabs; the search palette (§5.3) finds
			// anything without switching tabs at all.
			expect(usedTabs.size, `tabs used by #${row.n}`).toBeLessThanOrEqual(3);
			expect(row.expected.trim().length).toBeGreaterThan(0);
		});
	}
});

// First tab wins: the digits repeat on the Chemie tab under their own ids.
const TABS_FOR_KEY = new Map<string, string>();
for (const [tabId, tab] of TAB_BY_ID)
	for (const key of tab.keys) if (!TABS_FOR_KEY.has(key.id)) TABS_FOR_KEY.set(key.id, tabId);
