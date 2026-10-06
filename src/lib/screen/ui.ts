/** The `ui` region: which panels are open and which one-time notes are on screen. */
import { groupsOf } from '$lib/domain/groups';
import type { ScreenInput, UiRegion } from './types';

export function buildUi(input: ScreenInput): UiRegion {
	const { ui } = input;
	// The note is for Pokročilý, once, when the tree shows cards split into parts. It
	// is remembered per browser (`partsNoteSeen`), which is a preference, not the
	// course's state.
	const eligible =
		!ui.sidebarCollapsed && input.mode === 'advanced' && groupsOf(input.source).size > 0;
	return {
		validation_panel_open: ui.validationOpen,
		review_open: ui.reviewOpen,
		sidebar_collapsed: ui.sidebarCollapsed,
		parts_note: { eligible, shown: eligible && ui.partsNoteSeen === false }
	};
}
