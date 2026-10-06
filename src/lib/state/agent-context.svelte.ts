/**
 * The AI's `AgentContext` in the browser: the headless one over the live `DocStore`,
 * with the teacher behind `confirm` (a dialog, `AiConfirmDialog.svelte`), the preview
 * behind `show_in_preview`, and the version history behind the checkpoint.
 *
 * The checkpoint: the first AI change of a session saves the course as it was, as one
 * version "Před úpravami AI", but only when the course differs from the newest saved
 * version — a course that is already saved needs no second copy. A version that cannot
 * be saved is said, never swallowed, and never stops the change.
 */
import { createHeadlessContext, type AgentContext } from '$lib/agent/context';
import type { CourseV2 } from '$lib/domain/schema';
import type { DocStore } from './doc-store.svelte';
import { notices } from './notice.svelte';
import type { VersionStore } from './versions/version-store.svelte';

export function createBrowserContext(store: DocStore, versions: VersionStore): AgentContext {
	store.onBeforeAiSession = async (source: CourseV2, label: string) => {
		try {
			if (versions.modified(source)) await versions.save(source, label);
		} catch {
			notices.show({
				text: 'Verzi kurzu před úpravami AI se nepodařilo uložit. Změny asistenta jdou vrátit i bez ní.'
			});
		}
	};
	return createHeadlessContext(store, {
		confirm: (request) => store.ai.ask(request),
		follow: (ref) => store.follow(ref),
		showPreview: (view) => {
			store.preview.view = view;
		}
	});
}

/**
 * "Vrátit až sem": undo the AI's changes after `actionId`, newest first, so that it is
 * the last one left. It stops at a change the teacher made in between, which only the
 * teacher's own Zpět may take back. Returns how many were undone and whether it got there.
 */
export function revertAiTo(
	store: DocStore,
	actionId: string
): { undone: number; reached: boolean } {
	let undone = 0;
	const target = store.aiActions.find((a) => a.actionId === actionId);
	if (target === undefined || target.undone) return { undone, reached: false };
	for (;;) {
		const top = store.undoStack.at(-1);
		if (top?.origin !== 'ai') return { undone, reached: false };
		if (top.actionId === actionId) return { undone, reached: true };
		if (store.undoLastAiAction() === undefined) return { undone, reached: false };
		undone++;
	}
}
