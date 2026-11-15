import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LAYOUT,
	UI_KEY,
	parseLayout,
	readLayout,
	serialiseLayout,
	writeLayout
} from './layout-prefs';

const memory = () => {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v)
	};
};

describe('layout prefs', () => {
	it('defaults to both panels open', () => {
		expect(DEFAULT_LAYOUT).toEqual({
			sidebarCollapsed: false,
			previewCollapsed: false,
			aiTab: false
		});
		expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
	});

	it('round-trips', () => {
		const prefs = { sidebarCollapsed: true, previewCollapsed: true, aiTab: true };
		expect(parseLayout(serialiseLayout(prefs))).toEqual(prefs);
		expect(
			parseLayout(
				serialiseLayout({ sidebarCollapsed: true, previewCollapsed: false, aiTab: false })
			)
		).toEqual({
			sidebarCollapsed: true,
			previewCollapsed: false,
			aiTab: false
		});
	});

	it.each(['', 'nope', '{', 'null', '[]', '"x"', '{"format":2,"sidebarCollapsed":true}', '{}'])(
		'reads garbage %j as the default',
		(text) => {
			expect(parseLayout(text)).toEqual(DEFAULT_LAYOUT);
		}
	);

	it('keeps a good field when its neighbour is damaged', () => {
		expect(parseLayout('{"format":1,"sidebarCollapsed":true,"previewCollapsed":"yes"}')).toEqual({
			sidebarCollapsed: true,
			previewCollapsed: false,
			aiTab: false
		});
		expect(parseLayout('{"format":1,"previewCollapsed":true}')).toEqual({
			sidebarCollapsed: false,
			previewCollapsed: true,
			aiTab: false
		});
	});

	it('reads a layout saved before the AI tab existed as not on it', () => {
		expect(parseLayout('{"format":1,"sidebarCollapsed":true,"previewCollapsed":true}').aiTab).toBe(
			false
		);
		expect(parseLayout('{"format":1,"aiTab":true}').aiTab).toBe(true);
	});

	it('writes under its own key and reads it back', () => {
		const storage = memory();
		writeLayout(storage, { sidebarCollapsed: true, previewCollapsed: false, aiTab: true });
		expect([...storage.map.keys()]).toEqual([UI_KEY]);
		expect(readLayout(storage)).toEqual({
			sidebarCollapsed: true,
			previewCollapsed: false,
			aiTab: true
		});
	});

	it('never throws when storage does', () => {
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('quota');
			}
		};
		expect(readLayout(broken)).toEqual(DEFAULT_LAYOUT);
		expect(() => writeLayout(broken, DEFAULT_LAYOUT)).not.toThrow();
	});
});
