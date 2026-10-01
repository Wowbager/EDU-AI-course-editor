import { getContext, setContext } from 'svelte';
import { matchSections, type FieldLevel, type Mode } from './fields';

/**
 * The search over one settings dialog: what has been typed, and what it finds. The
 * dialog owns it and hands it down by context, so the section list can narrow and
 * `FieldGroup` can mark the fields it found without every dialog threading it through.
 */
export class SettingsSearch {
	query = $state('');
	readonly active = $derived(this.query.trim() !== '');
	readonly result;

	constructor(levels: readonly FieldLevel[], view: () => { mode: Mode; feedback: boolean }) {
		this.result = $derived(matchSections(levels, this.query, view().mode, view().feedback));
	}

	/** Whether a field is one the search found. Nothing is marked while it is empty. */
	marks(level: FieldLevel, path: string): boolean {
		return this.active && this.result.fields.has(`${level}.${path}`);
	}
}

const KEY = Symbol('settings-search');
export const setSettingsSearch = (search: SettingsSearch) => setContext(KEY, search);
export const useSettingsSearch = (): SettingsSearch | undefined => getContext(KEY);
