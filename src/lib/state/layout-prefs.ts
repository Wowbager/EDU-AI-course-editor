import { z } from 'zod';

/**
 * How the teacher arranged the screen — which side panels are folded away. It has
 * its own key and is never part of the draft: the draft's key is the one the other
 * tabs watch to detect a conflicting edit, and folding a panel is not an edit.
 */
export const UI_KEY = 'edu-editor:ui:v1';

export type LayoutPrefs = { sidebarCollapsed: boolean; previewCollapsed: boolean };

export const DEFAULT_LAYOUT: LayoutPrefs = { sidebarCollapsed: false, previewCollapsed: false };

const layoutSchema = z.object({
	format: z.literal(1),
	sidebarCollapsed: z.boolean().catch(false),
	previewCollapsed: z.boolean().catch(false)
});

/** Never throws: a missing, damaged or foreign value is the default layout. */
export function parseLayout(text: string | null): LayoutPrefs {
	if (text === null) return { ...DEFAULT_LAYOUT };
	try {
		const { sidebarCollapsed, previewCollapsed } = layoutSchema.parse(JSON.parse(text));
		return { sidebarCollapsed, previewCollapsed };
	} catch {
		return { ...DEFAULT_LAYOUT };
	}
}

export function serialiseLayout(prefs: LayoutPrefs): string {
	return JSON.stringify({
		format: 1,
		sidebarCollapsed: prefs.sidebarCollapsed,
		previewCollapsed: prefs.previewCollapsed
	});
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** Storage can be missing or throw (private window, blocked site data). */
export function readLayout(storage: Store): LayoutPrefs {
	try {
		return parseLayout(storage.getItem(UI_KEY));
	} catch {
		return { ...DEFAULT_LAYOUT };
	}
}

export function writeLayout(storage: Store, prefs: LayoutPrefs): void {
	try {
		storage.setItem(UI_KEY, serialiseLayout(prefs));
	} catch {
		// The layout is a convenience; failing to remember it must never break editing.
	}
}
