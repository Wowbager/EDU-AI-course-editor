import { getContext, setContext } from 'svelte';
import { matchHigherModes, matchSections, type FieldLevel, type Mode } from './fields';

/**
 * The search over one settings dialog: what has been typed, and what it finds. The
 * dialog owns it and hands it down by context, so the section list can narrow and
 * `FieldGroup` can mark the fields it found without every dialog threading it through.
 *
 * It exists in every mode. What a higher mode has is offered as a result of its own
 * (`higher`), and the same object carries the request to open a section after the mode
 * was switched (`jump`), because it is the one thing the dialog and its list share.
 */
export class SettingsSearch {
	query = $state('');
	readonly active = $derived(this.query.trim() !== '');
	readonly result;
	/** What the query finds only in a higher mode, lowest mode first. */
	readonly higher;
	/** A request to show a section; a new object each time, so asking twice for one works. */
	jump = $state<{ section: string } | null>(null);

	constructor(levels: () => readonly FieldLevel[], view: () => { mode: Mode; feedback: boolean }) {
		this.result = $derived(matchSections(levels(), this.query, view().mode, view().feedback));
		this.higher = $derived(matchHigherModes(levels(), this.query, view().mode, view().feedback));
	}

	/** Open on `section` once the mode that has it is on. */
	show(section: string): void {
		this.jump = { section };
	}

	/** Whether a field is one the search found. Nothing is marked while it is empty. */
	marks(level: FieldLevel, path: string): boolean {
		return this.active && this.result.fields.has(`${level}.${path}`);
	}
}

const KEY = Symbol('settings-search');
export const setSettingsSearch = (search: SettingsSearch) => setContext(KEY, search);
export const useSettingsSearch = (): SettingsSearch | undefined => getContext(KEY);
