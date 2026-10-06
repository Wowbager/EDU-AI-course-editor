/**
 * What the preview column knows, kept where the screen model can read it. The column
 * owns the iframe and the bridge; it reports here, and `store.screen.preview` says it
 * to the teacher (and, later, to the AI) in one voice.
 *
 * Nothing here decides what is shown: `screen/preview.ts` does, from this and from
 * what is open.
 */
import type { PreviewView } from '$lib/preview/bridge';
import type { PreviewBoot, PreviewCompleted, PreviewSync } from '$lib/screen/types';

export type { PreviewBoot, PreviewCompleted, PreviewSync };

export class PreviewState {
	/** Náhled (`expanded`) or Vyzkoušet (`play`). */
	view = $state<PreviewView>('expanded');
	/**
	 * What a played run was started with: the lesson and the first block. Both are
	 * pinned when the mode is entered and never follow the selection, which the run
	 * itself moves (`PreviewColumn`).
	 */
	run = $state<{ lessonId: string | undefined; startBlockId: string | undefined } | null>(null);
	boot = $state<PreviewBoot>('probing');
	sync = $state<PreviewSync>('idle');
	/** Why the player could not draw the draft, in its words. */
	error = $state<string | undefined>(undefined);
	canGoBack = $state(false);
	completed = $state<PreviewCompleted | null>(null);

	/** The player says it is drawing what was sent, or why it cannot. */
	inspected(content: 'none' | 'block' | 'lesson' | 'error', error?: string) {
		if (content === 'error') {
			this.sync = 'player_error';
			this.error = error ?? '';
		} else {
			this.sync = 'in_sync';
			this.error = undefined;
		}
	}

	/** A new player, or a new run: nothing known about it yet. */
	restarted() {
		this.sync = 'idle';
		this.error = undefined;
		this.canGoBack = false;
		this.completed = null;
	}
}
