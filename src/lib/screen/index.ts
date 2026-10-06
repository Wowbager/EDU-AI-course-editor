/**
 * The screen model. Pure builders of `ScreenInput`; no Svelte, no DOM. `DocStore`
 * exposes the regions as `store.screen.<region>`; the AI tools read the same objects
 * (`serialise.ts`).
 */
import { buildCard } from './card';
import { buildDialogs } from './dialogs';
import { buildIssues } from './issues';
import { buildNotices } from './notices';
import { buildPickers } from './pickers';
import { buildPreview } from './preview';
import { buildTopbar } from './topbar';
import { buildTree } from './tree';
import { buildUi } from './ui';
import type { Screen, ScreenInput } from './types';

export {
	buildCard,
	buildDialogs,
	buildIssues,
	buildNotices,
	buildPickers,
	buildPreview,
	buildTopbar,
	buildTree,
	buildUi
};
export { issueSets, panelKey } from './issues';
export { cutOffText } from './notices';
export { resolveOpen } from './open';
export { screenSlice } from './serialise';
export type * from './types';

export function buildScreen(input: ScreenInput): Screen {
	return {
		topbar: buildTopbar(input),
		tree: buildTree(input),
		issues: buildIssues(input),
		preview: buildPreview(input),
		notices: buildNotices(input),
		ui: buildUi(input),
		card: buildCard(input),
		pickers: buildPickers(input),
		dialogs: buildDialogs(input)
	};
}
