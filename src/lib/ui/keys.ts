/**
 * Keys for `{#each}` and `svelte-dnd-action` that stay unique when the document is
 * broken. Duplicate ids are something validation reports (`E_DUPLICATE_STEP_ID`,
 * `W_DUPLICATE_OPTION_ID`), not something the editor may crash on, and a keyed each
 * throws `each_key_duplicate` on the first repeat.
 *
 * The first occurrence keeps its id, so in a healthy document the key *is* the id
 * and nothing that keys view state by id notices. Later occurrences get `#2`, `#3`…
 * which is stable under reordering as long as the duplicates keep their relative
 * order — good enough for a document that is already wrong.
 */
export function uniqueKeys(ids: readonly string[]): string[] {
	const taken = new Set(ids);
	const used = new Set<string>();
	return ids.map((id) => {
		if (!used.has(id)) {
			used.add(id);
			return id;
		}
		// Skip any suffix that is itself somebody's real id, or was already handed out.
		let n = 2;
		while (used.has(`${id}#${n}`) || taken.has(`${id}#${n}`)) n++;
		const key = `${id}#${n}`;
		used.add(key);
		return key;
	});
}
