/**
 * The AI assistant's drawer, as the screen model sees it (`store.screen.ai`): whether it
 * is open, whether the server has an AI at all, the conversation the teacher reads, and
 * the question the AI is waiting for the teacher to answer.
 *
 * Only what is drawn. The conversation sent to the model — with its reasoning, tool
 * calls and results — is the `ChatSession`'s (`agent/chat.svelte.ts`), and none of it
 * is shown. Nothing here is about the course.
 */
import type { AiLine } from '$lib/screen/types';
import type { ConfirmRequest } from '$lib/agent/tool';

export interface PendingConfirm {
	request: ConfirmRequest;
	resolve: (allowed: boolean) => void;
}

export class AiState {
	panelOpen = $state(false);
	/** Whether the server has an AI set up; null until `checkStatus` has an answer. */
	configured = $state<boolean | null>(null);
	/** A message of the teacher's is being worked on. */
	running = $state(false);
	/** The model is reasoning and has said nothing yet. */
	thinking = $state(false);
	/** Replaced, never mutated, so a streamed word is one assignment. */
	lines = $state.raw<readonly AiLine[]>([]);
	confirm = $state.raw<PendingConfirm | null>(null);
	#count = 0;

	/** Add a line; returns its id, for `append`. */
	addLine(role: AiLine['role'], text: string): number {
		const id = ++this.#count;
		this.lines = [...this.lines, { id, role, text }];
		return id;
	}

	/** More text for a line that is being streamed. */
	append(id: number, text: string) {
		this.lines = this.lines.map((line) =>
			line.id === id ? { ...line, text: line.text + text } : line
		);
	}

	/** Drop a line that came out empty (a turn of tool calls with no words). */
	removeLine(id: number) {
		this.lines = this.lines.filter((line) => line.id !== id);
	}

	clear() {
		this.lines = [];
	}

	/**
	 * Ask the teacher. The answer is the dialog's button; a question asked while one is
	 * open declines the old one, because only one thing is ever waiting.
	 */
	ask(request: ConfirmRequest): Promise<boolean> {
		this.confirm?.resolve(false);
		return new Promise<boolean>((resolve) => {
			this.confirm = {
				request,
				resolve: (allowed) => {
					if (this.confirm?.request === request) this.confirm = null;
					resolve(allowed);
				}
			};
		});
	}

	/** Ask the server whether an AI is set up. A failure to reach it leaves the button on. */
	async checkStatus(fetcher: typeof fetch = fetch): Promise<void> {
		try {
			const response = await fetcher('/ai/chat', { headers: { accept: 'application/json' } });
			if (!response.ok) {
				this.configured = response.status === 503 ? false : null;
				return;
			}
			const body = (await response.json()) as { configured?: unknown };
			this.configured = body.configured === true;
		} catch {
			this.configured = null;
		}
	}
}
