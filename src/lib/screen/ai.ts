/**
 * The `ai` region: the AI assistant's button and drawer — whether it is available, the
 * conversation the teacher sees, what the AI has changed and the question it is waiting
 * on. The words of the AI's own replies are the teacher's to read and are drawn as they
 * are; everything else the drawer says is made here.
 *
 * The agent is not offered this region through `get_screen`: it would be the
 * conversation read back to itself.
 */
import type { AiRegion, ScreenInput } from './types';

export const AI_UNCONFIGURED = 'AI není nastavena';

export function buildAi(input: ScreenInput): AiRegion {
	const { ai } = input;
	const configured = ai.configured;
	return {
		button: {
			label: configured === false ? AI_UNCONFIGURED : 'AI asistent',
			title:
				configured === false
					? 'Na tomto serveru není AI zapnutá.'
					: 'Asistent, který kurz čte, zkouší a po schválení upravuje.',
			disabled: configured === false,
			pressed: ai.panelOpen
		},
		panel_open: ai.panelOpen,
		configured,
		status_text: configured === false ? AI_UNCONFIGURED : null,
		running: ai.running,
		thinking_text: ai.thinking ? 'Přemýšlí…' : null,
		messages: ai.lines.map((line) => ({
			key: `m${line.id}`,
			role: line.role,
			text: line.text.trim()
		})),
		messages_count: ai.lines.length,
		empty_text:
			ai.lines.length === 0
				? 'Napiš, s čím ti mám pomoct: projít lekci jako žák, opravit chyby, doplnit otázku. Každou změnu uvidíš v seznamu níže a můžeš ji vrátit.'
				: null,
		actions_heading: ai.actions.length === 0 ? null : 'Co asistent změnil',
		actions: ai.actions.map((action) => ({
			key: action.actionId,
			text: action.description,
			undone: action.undone,
			ref: action.ref ?? null
		})),
		can_revert: ai.actions.length > 0,
		confirm:
			ai.confirm === null
				? null
				: {
						title: ai.confirm.title,
						message: ai.confirm.message,
						items: [...ai.confirm.items],
						destructive: ai.confirm.destructive
					}
	};
}
