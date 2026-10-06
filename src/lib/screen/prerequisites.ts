/**
 * `learning.prerequisites` as the card's settings show it: one sentence per rule
 * („Nejdřív karta „Kolik je?“ (Lekce 2) · aspoň 50 %“), the percentage as a field, and
 * the picker that changes what a rule waits for. The sentences, the disabled reasons and
 * the picker's tree used to be built inside `PrerequisiteEditor`.
 */
import type { BlockV2, CourseV2, PrerequisiteRule } from '$lib/domain/schema';
import { refKey, type Ref } from '$lib/domain/ref';
import { cardGroups, cardNames } from '$lib/domain/naming';
import { notANumberMessage } from '$lib/domain/number-input';
import { skillTree, type SkillTreeArea } from '$lib/domain/skill-config';
import { cardsWaitingFor } from '$lib/domain/validate';
import { allows, fieldSpec } from '$lib/ui/fields';
import type { PickerStep } from '$lib/ui/choice-picker';
import type { PrerequisiteRuleView, PrerequisitesView, ScreenInput } from './types';

/** A new rule asks for this much, and an emptied field gives back this much. */
export const DEFAULT_LEVEL = 0.5;

/** The stored 0–1 as a whole percentage. */
export const percentOf = (level: number): number => Math.round(level * 100);

type Level = {
	area: SkillTreeArea;
	skill: SkillTreeArea['skills'][number];
	level: { level: number; dimension: { code: string; name: string } };
};

/** The skill level a rule's code stands for, with where it sits in the tree. */
export function levelsByCode(tree: SkillTreeArea[]): Map<string, Level> {
	return new Map(
		tree.flatMap((area) =>
			area.skills.flatMap((skill) =>
				skill.levels.map((l) => [l.dimension.code, { area, skill, level: l }] as const)
			)
		)
	);
}

/** Where the picker opens for a rule: on the list its current choice is in. */
export function prerequisitePath(rule: PrerequisiteRule, levels: Map<string, Level>): string[] {
	if (rule.block_id !== undefined) return ['card'];
	const found = rule.skill === undefined ? undefined : levels.get(rule.skill);
	if (found === undefined) return [];
	return found.skill.levels.length > 1
		? ['skill', `${found.area.code}/${found.skill.code}`]
		: ['skill'];
}

/** What a rule says before „aspoň“, in words. */
function describe(
	doc: CourseV2,
	rule: PrerequisiteRule,
	levels: Map<string, Level>,
	showCodes: boolean
): { text: string; where: string | null; code: string | null } {
	if (rule.block_id !== undefined) {
		const card = cardNames(doc).get(rule.block_id);
		if (card === undefined)
			return { text: 'Nejdřív karta, která už neexistuje', where: null, code: null };
		return {
			text: `Nejdřív karta „${card.name}“`,
			where: card.collides ? card.place : card.lesson,
			code: null
		};
	}
	if (rule.skill !== undefined) {
		const found = levels.get(rule.skill);
		if (found === undefined) {
			return { text: 'Nejdřív dovednost, která už není v nastavení', where: null, code: null };
		}
		const many = found.skill.levels.length > 1;
		return {
			text: `Nejdřív dovednost ${found.skill.name}${many ? ` · Úroveň ${found.level.level}` : ''}`,
			where: null,
			code: showCodes ? rule.skill : null
		};
	}
	return { text: 'Nejdřív … (vyber kartu nebo dovednost)', where: null, code: null };
}

export function buildPrerequisites(input: ScreenInput, block: BlockV2): PrerequisitesView {
	const rules = block.learning?.prerequisites ?? [];
	const levels = levelsByCode(skillTree(input.skillConfig));
	// A skill's code is part of the taxonomy vector, which only Pokročilý shows.
	const showCodes = allows('block', 'gpf.vector', input.mode);
	const spec = fieldSpec('block', 'learning.prerequisites.min_level');
	return {
		rules: rules.map((rule, index): PrerequisiteRuleView => {
			const said = describe(input.doc, rule, levels, showCodes);
			const ref: Ref = {
				blockId: block.block_id,
				field: `learning.prerequisites.${index}.min_level`
			};
			const draft = input.drafts[refKey(ref)];
			return {
				...said,
				path: prerequisitePath(rule, levels),
				min_level: {
					key: `learning.prerequisites.${index}.min_level`,
					level: 'block',
					path: 'learning.prerequisites.min_level',
					label: 'Požadované zvládnutí v procentech',
					hint: null,
					kind: 'number',
					display: null,
					value: String(percentOf(rule.min_level)),
					checked: null,
					empty_text: '',
					options: null,
					numeric: false,
					draft: draft ?? null,
					error: draft === undefined ? null : notANumberMessage(draft),
					min: spec?.min ?? null,
					max: spec?.max ?? null,
					disabled: false,
					ref
				}
			};
		}),
		problem: input.ui.prerequisite.problem
	};
}

/**
 * The picker „Na co karta čeká?“: another card (grouped by lesson) or a skill (area →
 * skill → level). A card that already waits for this one, directly or through others,
 * would make a cycle, so it is listed but cannot be picked; so is a card another rule of
 * this card already uses. `editing` is the rule being changed, whose own choice is
 * marked and free.
 */
export function prerequisiteStep(
	input: ScreenInput,
	block: BlockV2,
	editing: number | null
): PickerStep {
	const { doc } = input;
	const rules = block.learning?.prerequisites ?? [];
	const tree = skillTree(input.skillConfig);
	const showCodes = allows('block', 'gpf.vector', input.mode);
	const waiting = cardsWaitingFor(doc, block.block_id);
	const own = editing === null ? undefined : rules[editing];
	const used = new Set(
		rules.flatMap((r, i) => (r.block_id !== undefined && i !== editing ? [r.block_id] : []))
	);

	const cardStep: PickerStep = {
		title: 'Jaká karta',
		empty: 'Žádná další karta, na kterou by šlo navázat.',
		groups: cardGroups(doc, { exclude: block.block_id }).map((group) => ({
			heading: group.title,
			items: group.cards.map((card) => ({
				id: card.id,
				name: card.name,
				detail: card.collides ? card.place : undefined,
				current: own?.block_id === card.id,
				disabledReason: waiting.has(card.id)
					? 'čeká na tuhle kartu, nemůže být před ní'
					: used.has(card.id)
						? 'už je v předpokladech'
						: undefined
			}))
		}))
	};

	const ownSkill = own?.skill;
	const skillStep: PickerStep = {
		title: 'Dovednost',
		empty: 'Kurz nemá nastavené dovednosti.',
		groups: tree.map((area) => ({
			heading: area.name,
			items: area.skills.map((skill) => {
				const levelItems = skill.levels.map((l) => ({
					id: l.dimension.code,
					name: `Úroveň ${l.level}`,
					detail: l.dimension.name,
					hint: showCodes ? l.dimension.code : undefined,
					current: ownSkill === l.dimension.code
				}));
				// A skill with one level has nothing to choose after it.
				return skill.levels.length === 1
					? { ...levelItems[0], name: skill.name, detail: undefined }
					: {
							id: `${area.code}/${skill.code}`,
							name: skill.name,
							current: levelItems.some((l) => l.current),
							next: { title: 'Úroveň', subject: skill.name, groups: [{ items: levelItems }] }
						};
			})
		}))
	};

	return {
		title: 'Na co karta čeká?',
		groups: [
			{
				items: [
					{
						id: 'card',
						name: 'Jinou kartu',
						detail: 'Počká, až žák zvládne jinou kartu.',
						current: editing !== null && own?.block_id !== undefined,
						next: cardStep
					},
					{
						id: 'skill',
						name: 'Dovednost',
						detail: 'Počká, až žák zvládne dovednost na určité úrovni.',
						current: editing !== null && own?.skill !== undefined,
						next: skillStep
					}
				]
			}
		]
	};
}
