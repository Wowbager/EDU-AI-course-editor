/**
 * The pure half of `ChoicePicker`: what a list of choices looks like as data, which of
 * them a search keeps, and where an item chosen earlier sits, so a picker can reopen on
 * it. Kept free of the DOM so the rules can be tested without a browser.
 *
 * A picker shows one **step** at a time: groups (a heading and its items). An item
 * either is a final choice or opens a next step (`next`), which is how "area → skill →
 * level" is walked. A choice is reported as the **path** of item ids from the first
 * step to the item picked.
 */
export interface PickerItem {
	/** What the owner gets back in the path; never shown. */
	id: string;
	/** First line. */
	name: string;
	/** Second line: where it is, or what it means. */
	detail?: string;
	/** A faint code after the name, for the advanced author only. */
	hint?: string;
	/** Shown on the item, which then cannot be picked. */
	disabledReason?: string;
	/** The choice that is in force now; it is marked, and the picker opens on it. */
	current?: boolean;
	/** Picking the item opens this step instead of finishing. */
	next?: PickerStep;
}

export interface PickerGroup {
	heading?: string;
	items: PickerItem[];
}

export interface PickerStep {
	/** The small-capitals title. */
	title: string;
	/** What the step is about, once a step has been walked into ("Zlomky"). */
	subject?: string;
	groups: PickerGroup[];
	/** Said when there is nothing to choose from. */
	empty?: string;
}

/** A search field is worth its room only once a list is long. */
export const SEARCH_THRESHOLD = 8;

/** Lower case without diacritics, so „zlomky“ finds „Zlomky“ and „uvod“ finds „Úvod“. */
const fold = (text: string): string =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

export const itemCount = (groups: readonly PickerGroup[]): number =>
	groups.reduce((sum, g) => sum + g.items.length, 0);

export const needsSearch = (groups: readonly PickerGroup[]): boolean =>
	itemCount(groups) > SEARCH_THRESHOLD;

/**
 * The items whose name, second line or hint contain every word typed, diacritics and
 * case ignored, under the headings that still have something. An empty query keeps all.
 * A group whose own heading matches keeps all its items ("lekce 2" lists the lesson).
 */
export function filterGroups(groups: readonly PickerGroup[], query: string): PickerGroup[] {
	const words = fold(query)
		.split(/\s+/)
		.filter((w) => w !== '');
	if (words.length === 0) return groups.map((g) => ({ ...g }));
	const hits = (text: string) => {
		const folded = fold(text);
		return words.every((w) => folded.includes(w));
	};
	return groups
		.map((group) => {
			const heading = group.heading ?? '';
			const all = heading !== '' && hits(heading);
			return {
				...group,
				items: group.items.filter(
					(i) => all || hits(`${heading} ${i.name} ${i.detail ?? ''} ${i.hint ?? ''}`)
				)
			};
		})
		.filter((g) => g.items.length > 0);
}

/** Every item that can be picked right now, in order — what Enter in the search takes first of. */
export const pickable = (groups: readonly PickerGroup[]): PickerItem[] =>
	groups.flatMap((g) => g.items).filter((i) => i.disabledReason === undefined);

/**
 * The steps walked into by following `path` from `root`, `root` first. A path that
 * stops matching (an item that is gone) ends the trail where it still did, so the
 * picker opens on the deepest step that exists rather than on nothing.
 */
export function followPath(root: PickerStep, path: readonly string[]): PickerStep[] {
	const trail = [root];
	for (const id of path) {
		const step = trail[trail.length - 1];
		const item = step.groups.flatMap((g) => g.items).find((i) => i.id === id);
		if (item?.next === undefined) break;
		trail.push(item.next);
	}
	return trail;
}

/** Items marked as the current choice, or the first one that can be picked. */
export function firstToFocus(groups: readonly PickerGroup[]): PickerItem | undefined {
	const all = groups.flatMap((g) => g.items);
	return all.find((i) => i.current === true) ?? all[0];
}
