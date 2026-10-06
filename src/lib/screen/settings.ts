/**
 * The settings dialogs as the teacher sees them: the course's, a lesson's and a card's.
 * Which sections a mode lists, which fields a section holds, what each says, the
 * skill rows with their levels and codes, the pojmy with their suggestions, the RVP
 * outputs with their total, the lesson's totals and didactic shares — all of it is
 * built here, from `ui/fields.ts` (which mode shows what) and the domain, and drawn by
 * `CourseSettings`, `LessonSettings`, `CardSettings` and their editors, which compute
 * none of it.
 */
import {
	lessonDidactics,
	lessonTotals,
	bindingFlagsPractice,
	isPracticeBlock
} from '$lib/domain/derive';
import { blockTopics } from '$lib/domain/commands';
import { courseTerms, suggestTerms } from '$lib/domain/concepts';
import { groupOf, keepsQuestionsTogether, questionCount } from '$lib/domain/groups';
import { notANumberMessage } from '$lib/domain/number-input';
import { refKey, type Ref } from '$lib/domain/ref';
import type { BlockV2, ExportType, LessonBlockBinding } from '$lib/domain/schema';
import {
	dimensionCount,
	ELO_BASELINE,
	skillTree,
	type SkillDimension
} from '$lib/domain/skill-config';
import { VISIBILITY_LABEL, visibilityOf } from '$lib/domain/versions';
import {
	allows,
	fieldSpec,
	fieldsFor,
	listsSections,
	modeGain,
	sectionsFor,
	type FieldLevel,
	type FieldSpec
} from '$lib/ui/fields';
import { cardsCount, counted } from '$lib/ui/plural';
import { sectionHasIssue, sectionTargeted } from '$lib/ui/settings-target';
import { fieldViews } from './field-view';
import { issueSets } from './issues';
import { buildPrerequisites } from './prerequisites';
import type {
	CardSettingsView,
	CompetenciesView,
	ConceptsView,
	CourseSettingsView,
	FieldView,
	LessonSettingsView,
	ScreenInput,
	SettingsBaseView,
	TopicPanelItem,
	TopicPanelView,
	TopicsView
} from './types';

/** "Cvičení" is also a card type and the daily practice queue; this one is neither. */
const EXPORT_TYPES: { value: ExportType; label: string; title: string }[] = [
	{
		value: 'course_v2',
		label: 'Kurz',
		title: 'Celý kurz v plné podobě: nápovědy, řešení, větvení podle odpovědí, XP.'
	},
	{
		value: 'exercise_v2',
		// The qualifier is on the label and not only in the tooltip: the collision is
		// visible on screen, so the fix has to be too. The type itself is untouched.
		label: 'Cvičení (celý kurz)',
		title:
			'Celý kurz jako drilovací sada: větvení se ignoruje ve všech kartách, žák jde vždy stejným pořadím. Pozor, tohle je nastavení celého kurzu — není to karta typu Cvičení uvnitř lekce ani zařazení karty do denního opakování. V aplikaci se exportuje jako exercise_v2.'
	},
	{
		value: 'quiz_v2',
		label: 'Test',
		title: 'Celý kurz bez nápověd, řešení i zpětné vazby — žák se během něj nedozví, jak si vede.'
	}
];

/** The sections and the line about a higher mode, which every dialog has. */
function base(
	input: ScreenInput,
	title: string,
	levels: readonly FieldLevel[],
	scope: Ref,
	levelOf: (section: string) => FieldLevel,
	sections: ReturnType<typeof sectionsFor>
): SettingsBaseView {
	const sets = issueSets(input.validation, input.showFeedback, input.touched, input.reviewed);
	const source = { selection: input.selection, shown: sets.shown };
	const gain = modeGain(levels, input.mode, input.showFeedback);
	return {
		title,
		list: listsSections(input.mode),
		sections: sections.map((section) => ({
			id: section.id,
			label: section.label,
			icon: section.icon,
			alert: sectionHasIssue(source, [levelOf(section.id)], section.id, scope),
			targeted: sectionTargeted(source, [levelOf(section.id)], section.id, scope)
		})),
		gain: gain === undefined ? null : { text: gain.text, mode: gain.mode, section: gain.section }
	};
}

const bySection = (
	specs: readonly FieldSpec[],
	sections: { id: string }[],
	view: (specs: FieldSpec[]) => FieldView[]
): Record<string, FieldView[]> =>
	Object.fromEntries(
		sections.map((section) => [section.id, view(specs.filter((f) => f.section === section.id))])
	);

// ─────────────────────────────────────── the course ───────────────────────────────────────

export function buildCourseSettings(input: ScreenInput): CourseSettingsView | null {
	if (input.ui.dialog?.kind !== 'course') return null;
	const { doc, mode } = input;
	const sections = sectionsFor('course', mode);
	const specs = fieldsFor('course', mode);
	const context = { root: doc, scope: {}, drafts: input.drafts };
	return {
		...base(input, 'Nastavení kurzu', ['course'], {}, () => 'course', sections),
		course_id: doc.course_id,
		fields: bySection(specs, sections, (list) => fieldViews(list, context)),
		export_type: { value: doc.export_type, options: EXPORT_TYPES },
		visibility_label: VISIBILITY_LABEL[visibilityOf(doc)].label
	};
}

// ─────────────────────────────────────── the lesson ───────────────────────────────────────

export function buildLessonSettings(input: ScreenInput): LessonSettingsView | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'lesson') return null;
	const { doc, mode } = input;
	const lessonId = dialog.lessonId;
	const lesson = doc.lessons.find((l) => l.lesson_id === lessonId);
	const sections = sectionsFor('lesson', mode);
	const specs = fieldsFor('lesson', mode);
	const totals = lesson === undefined ? undefined : lessonTotals(lesson, input.index);
	const didactics = lesson === undefined ? undefined : lessonDidactics(lesson, input.index);
	const place = doc.lessons.findIndex((l) => l.lesson_id === lessonId);
	const armed = input.ui.armed === `lesson:${lessonId}`;
	return {
		...base(input, 'Nastavení lekce', ['lesson'], { lessonId }, () => 'lesson', sections),
		found: lesson !== undefined,
		gone_text: 'Tato lekce v kurzu není.',
		lesson_id: lessonId,
		fields:
			lesson === undefined
				? {}
				: bySection(specs, sections, (list) =>
						fieldViews(list, { root: lesson, scope: { lessonId }, drafts: input.drafts })
					),
		order: { up_disabled: place <= 0, down_disabled: place < 0 || place >= doc.lessons.length - 1 },
		totals:
			totals === undefined
				? null
				: {
						text: `${cardsCount(totals.cardCount)} · ${totals.durationMinutes} min${
							totals.durationEstimated ? ' (odhad)' : ''
						}`,
						title: totals.durationPartial
							? 'U některých karet délka chybí, součet je proto nižší.'
							: null
					},
		didactics:
			didactics === undefined
				? null
				: {
						rows: [
							...(input.showFeedback
								? [
										{
											label: 'Zpětná vazba u chybných odpovědí',
											title: 'Podíl chybných odpovědí, které žákovi řeknou, kde udělal chybu',
											value: `${Math.round(didactics.wrongOptionFeedbackShare * 100)} %`
										}
									]
								: []),
							{
								label: 'Karty zařazené do cvičení',
								title: 'Podíl karet zařazených do denního opakování',
								value: `${Math.round(didactics.practiceShare * 100)} %`
							}
						]
					},
		delete: {
			armed,
			text: armed ? 'Opravdu smazat? Klikni znovu' : 'Smazat',
			label: armed ? 'Opravdu smazat lekci? Klikni znovu' : 'Smazat lekci'
		}
	};
}

// ─────────────────────────────────────── the card ───────────────────────────────────────

/** How often a card comes back: the gaps first, the memory model's starting values after. */
const GAPS_FIRST = ['fsrs.min_interval', 'fsrs.max_interval'];

export function buildCardSettings(input: ScreenInput): CardSettingsView | null {
	const dialog = input.ui.dialog;
	if (dialog === null || dialog.kind !== 'card') return null;
	const { doc, mode } = input;
	const block = doc.blocks.find((b) => b.block_id === dialog.blockId);
	if (block === undefined) return null;
	// Only the open card has settings; a stale dialog for another card shows none.
	if (input.open.card?.block_id !== block.block_id) return null;
	const binding = input.open.binding;
	const feedback = input.showFeedback;
	const scope: Ref = { blockId: block.block_id };

	const blockSpecs = fieldsFor('block', mode, feedback);
	const bindingSpecs = binding === undefined ? [] : fieldsFor('binding', mode, feedback);
	/**
	 * The card's sections, and the lesson's binding as one more just before the card's
	 * details: it is about this card, but only where this lesson shows it.
	 */
	const own = sectionsFor('block', mode, feedback);
	const lessonSection = bindingSpecs.length > 0 ? sectionsFor('binding', mode, feedback) : [];
	const at = own.findIndex((s) => s.id === 'meta');
	const sections =
		at === -1
			? [...own, ...lessonSection]
			: [...own.slice(0, at), ...lessonSection, ...own.slice(at)];

	const practice = isPracticeBlock(block, bindingFlagsPractice(doc, block.block_id));
	const blockContext = {
		root: block,
		scope,
		drafts: input.drafts,
		// The switch shows whether the card is in practice however it got there.
		override: (path: string) => (path === 'default_practice' ? practice : undefined)
	};
	const bindingContext = {
		root: binding as LessonBlockBinding | undefined,
		scope: { lessonId: input.open.lesson?.lesson_id, blockId: block.block_id },
		drafts: input.drafts
	};
	const inSection = (id: string) => blockSpecs.filter((f) => f.section === id);
	const reviewPlan = inSection('review')
		.filter((f) => !f.path.startsWith('fsrs.initial_'))
		.sort((a, b) => Number(GAPS_FIRST.includes(b.path)) - Number(GAPS_FIRST.includes(a.path)));

	const fields: Record<string, FieldView[]> = {};
	for (const section of sections) {
		fields[section.id] =
			section.id === 'lesson'
				? fieldViews(bindingSpecs, bindingContext)
				: section.id === 'review'
					? []
					: fieldViews(inSection(section.id), blockContext);
	}

	// Whether this card's questions are graded as one item (`domain/groups.ts`): every
	// question is its own card by default; the advanced author may keep a card whole,
	// for a retry that branches between its own questions.
	const together = keepsQuestionsTogether(block);
	const card = groupOf(block);
	const togetherAllowed = allows('block', 'grouping.together', mode);
	const canKeepTogether =
		togetherAllowed &&
		block.type !== 'display' &&
		(together ||
			(card !== undefined && input.source.blocks.filter((b) => groupOf(b) === card).length > 1));
	const togetherSpec = fieldSpec('block', 'grouping.together');
	const consequence = (() => {
		if (together) {
			const n = questionCount(block);
			return `Rozdělí kartu na ${counted(n, 'samostatnou kartu', 'samostatné karty', 'samostatných karet')}.`;
		}
		if (card === undefined) return '';
		const n = input.source.blocks
			.filter((b) => groupOf(b) === card)
			.reduce((sum, b) => sum + Math.max(1, questionCount(b)), 0);
		return `Spojí ${counted(n, 'otázku', 'otázky', 'otázek')} této karty do jedné.`;
	})();

	return {
		...base(
			input,
			'Nastavení karty',
			binding === undefined ? ['block'] : ['block', 'binding'],
			scope,
			(id) => (id === 'lesson' ? 'binding' : 'block'),
			sections
		),
		block_id: block.block_id,
		fields,
		review: {
			plan: fieldViews(reviewPlan, blockContext),
			start: fieldViews(
				inSection('review').filter((f) => f.path.startsWith('fsrs.initial_')),
				blockContext
			)
		},
		together: canKeepTogether
			? {
					checked: together,
					label: togetherSpec?.label ?? 'Více otázek v jedné kartě',
					hint: togetherSpec?.hint ?? null,
					consequence,
					group: card ?? null
				}
			: null,
		together_note:
			together && questionCount(block) > 1 && !togetherAllowed
				? 'Otázky této karty se žákovi hodnotí jako jedna (nastaveno v pokročilém režimu).'
				: null,
		topics: buildTopics(input, block),
		concepts: buildConcepts(input, block),
		competencies: buildCompetencies(input, block),
		prerequisites: buildPrerequisites(input, block)
	};
}

// ─────────────────────────────────────── the skills ───────────────────────────────────────

const RELATIONS = [
	{ value: '2', label: 'Je o tom', title: 'Karta tuhle dovednost učí' },
	{ value: '1', label: 'Využívá', title: 'Karta ji potřebuje mimochodem' }
] as const;

function buildTopics(input: ScreenInput, block: BlockV2): TopicsView {
	const config = input.skillConfig;
	const count = dimensionCount(config);
	const tree = skillTree(config);
	const topics = blockTopics(block);
	const flow = input.ui.topic;
	const editing = flow.editing;
	const chosen = new Set(topics.map((t) => t.dimensionIndex));
	/** What is taken by another row: when editing, the edited row's own level is free. */
	const taken = new Set([...chosen].filter((i) => i !== editing));
	const strong = topics.filter((t) => t.relation === 2).length;
	const showCodes = allows('block', 'gpf.vector', input.mode);
	const eloSpec = fieldSpec('block', 'gpf.elo_vector.elo');
	const showElo = allows('block', 'gpf.elo_vector.elo', input.mode);

	/** Where each dimension sits in the tree, for the rows. */
	const place = new Map(
		tree.flatMap((area) =>
			area.skills.flatMap((skill) =>
				skill.levels.map(
					(l) => [l.dimension.dimension_index, { area, skill, level: l.level }] as const
				)
			)
		)
	);
	const dimensionAt = (index: number): SkillDimension | undefined =>
		config?.vector?.dimensions?.find((d) => d.dimension_index === index);

	const chips: TopicsView['chips'] = [];
	if (input.skillConfigStatus === 'loading') {
		chips.push({ tone: 'neutral', text: 'Dovednosti se načítají', title: null });
	} else if (count === null) {
		chips.push({ tone: 'warning', text: 'Nastavení dovedností se nenačetlo', title: null });
	} else if (topics.length === 0) {
		chips.push({
			tone: 'warning',
			text: 'nenastaveno',
			title: 'Bez vazby na dovednost se profil žáka po této kartě nepohne'
		});
	} else if (strong > 3) {
		chips.push({
			tone: 'warning',
			text: `${strong} silných vazeb`,
			title: 'Jeden výsledek se rozmělní do příliš mnoha dovedností'
		});
	}
	// Not a problem, so not amber: the course simply has no skill list of its own.
	if (input.skillConfigStatus === 'default') {
		chips.push({ tone: 'neutral', text: 'výchozí sada', title: null });
	}

	const rows = topics.map((topic) => {
		const where = place.get(topic.dimensionIndex);
		const dim = dimensionAt(topic.dimensionIndex);
		const skillName = where?.skill.name ?? dim?.name ?? 'neznámá dovednost';
		const many = where !== undefined && where.skill.levels.length > 1;
		const ref: Ref = { blockId: block.block_id, field: `gpf.elo_vector.${topic.dimensionIndex}` };
		const draft = input.drafts[refKey(ref)];
		return {
			dimension: topic.dimensionIndex,
			skill_key: where === undefined ? null : `${where.area.code}/${where.skill.code}`,
			skill_name: skillName,
			level: many ? `Úroveň ${where.level}` : null,
			code: showCodes && dim?.code ? dim.code : null,
			description: dim && where && dim.name !== skillName ? dim.name : null,
			label: `Změnit dovednost ${skillName}${many ? `, úroveň ${where.level}` : ''}`,
			relation: String(topic.relation) as '1' | '2',
			relation_label: `Jak karta pracuje s dovedností ${skillName}`,
			elo: showElo
				? ({
						key: `gpf.elo_vector.${topic.dimensionIndex}`,
						level: 'block',
						path: 'gpf.elo_vector.elo',
						label: 'obtížnost',
						hint: null,
						kind: 'number',
						display: null,
						value: String(topic.elo),
						checked: null,
						empty_text: `výchozí ${ELO_BASELINE}`,
						options: null,
						numeric: false,
						draft: draft ?? null,
						error: draft === undefined ? null : notANumberMessage(draft),
						min: eloSpec?.min ?? null,
						max: eloSpec?.max ?? null,
						disabled: false,
						ref
					} satisfies FieldView)
				: null,
			remove_label: `Odebrat ${skillName}`,
			flashed: flow.flashed === topic.dimensionIndex
		};
	});

	return {
		chips,
		default_note:
			input.skillConfigStatus === 'default'
				? 'Kurz nemá vlastní seznam dovedností, karta vybírá z obecného.'
				: null,
		configured: count !== null,
		rows,
		help: count === null ? null : topics.length > 0 ? 'rows' : 'none',
		panel: topicPanel(input, tree, taken, editing, place, dimensionAt)
	};
}

type Place = Map<
	number,
	{
		area: ReturnType<typeof skillTree>[number];
		skill: ReturnType<typeof skillTree>[number]['skills'][number];
		level: number;
	}
>;

function topicPanel(
	input: ScreenInput,
	tree: ReturnType<typeof skillTree>,
	taken: ReadonlySet<number>,
	editing: number | null,
	place: Place,
	dimensionAt: (index: number) => SkillDimension | undefined
): TopicPanelView {
	const flow = input.ui.topic;
	const skillKey = (area: { code: string }, skill: { code: string }) =>
		`${area.code}/${skill.code}`;
	const label = editing === null ? 'Přidat dovednost' : 'Změnit dovednost';
	const found = tree
		.flatMap((area) => area.skills.map((skill) => ({ area, skill })))
		.find(({ area, skill }) => skillKey(area, skill) === flow.skill);

	if (flow.step === 'level' && found !== undefined) {
		// Adding offers only the free levels; changing lists all, the taken ones disabled.
		const levels = found.skill.levels.filter(
			(l) => editing !== null || !taken.has(l.dimension.dimension_index)
		);
		return {
			step: 'level',
			label,
			title: 'Úroveň',
			back: editing === null ? 'Zpět' : 'Jiná dovednost',
			subject: found.skill.name,
			groups: [
				{
					heading: null,
					items: levels.map((l): TopicPanelItem => {
						const index = l.dimension.dimension_index;
						return {
							id: String(index),
							name: `Úroveň ${l.level}`,
							detail: l.dimension.name,
							reason: taken.has(index) ? 'už je na jiném řádku' : null,
							current: index === editing,
							quick: null,
							dimension: index
						};
					})
				}
			],
			empty: null
		};
	}

	if (flow.step === 'relation' && flow.dimension !== null) {
		const dimension = dimensionAt(flow.dimension);
		const where = place.get(flow.dimension);
		return {
			step: 'relation',
			label,
			title: 'Jak s ní karta pracuje',
			back: 'Zpět',
			subject:
				dimension === undefined
					? null
					: where === undefined
						? dimension.name
						: where.skill.levels.length > 1
							? `${where.skill.name}, úroveň ${where.level}`
							: where.skill.name,
			groups: [
				{
					heading: null,
					items: RELATIONS.map((r) => ({
						id: r.value,
						name: r.label,
						detail: r.title,
						reason: null,
						current: false,
						quick: null,
						dimension: null
					}))
				}
			],
			empty: null
		};
	}

	/** Skills with something left to choose, under their area. */
	const groups = tree
		.map((area) => ({
			heading: area.name,
			items: area.skills
				.filter((s) => s.levels.some((l) => !taken.has(l.dimension.dimension_index)))
				.map((skill): TopicPanelItem => {
					const free = skill.levels.filter((l) => !taken.has(l.dimension.dimension_index));
					return {
						id: skillKey(area, skill),
						name: skill.name,
						detail: null,
						reason: null,
						current: false,
						quick: editing === null && free.length === 1 ? free[0].dimension.dimension_index : null,
						dimension: null
					};
				})
		}))
		.filter((group) => group.items.length > 0);
	return {
		step: 'skill',
		label,
		title: 'Dovednost',
		back: null,
		subject: null,
		groups,
		empty: groups.length === 0 ? 'Všechny dovednosti už karta má.' : null
	};
}

// ────────────────────────────── pojmy and výstupy RVP ──────────────────────────────

function buildConcepts(input: ScreenInput, block: BlockV2): ConceptsView {
	const form = input.ui.concepts;
	const concepts = block.learning?.concepts ?? [];
	const suggestions = suggestTerms(courseTerms(input.source.blocks), concepts, form.draft);
	return {
		terms: concepts.map((term) => ({ term, remove_label: `Odebrat pojem ${term}` })),
		draft: form.draft,
		suggestions,
		listing: form.focused && suggestions.length > 0,
		active: form.active,
		problem: form.problem
	};
}

function buildCompetencies(input: ScreenInput, block: BlockV2): CompetenciesView {
	const form = input.ui.competency;
	const entries = Object.entries(block.learning?.competencies ?? {});
	const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
	const spec = fieldSpec('block', 'learning.competencies.weight');
	const weightField = (ref: Ref, value: number | undefined, key: string): FieldView => {
		const draft = input.drafts[refKey(ref)];
		return {
			key,
			level: 'block',
			path: 'learning.competencies.weight',
			label: spec?.label ?? 'Váha výstupu',
			hint: null,
			kind: 'number',
			display: null,
			value: value === undefined ? '' : String(value),
			checked: null,
			empty_text: '50',
			options: null,
			numeric: false,
			draft: draft ?? null,
			error: draft === undefined ? null : notANumberMessage(draft),
			min: spec?.min ?? null,
			max: spec?.max ?? null,
			disabled: false,
			ref
		};
	};
	return {
		entries: entries.map(([code, weight]) => ({
			code,
			weight: {
				...weightField(
					{ blockId: block.block_id, field: `learning.competencies.${code}` },
					weight,
					`learning.competencies.${code}`
				),
				label: `Váha výstupu ${code}`
			},
			renaming: form.editing === code,
			rename_label: `Kód výstupu ${code}`,
			change_label: `Změnit kód ${code}`,
			remove_label: `Odebrat ${code}`
		})),
		total:
			entries.length > 0 ? { text: `${total} %`, tone: total > 100 ? 'warning' : 'neutral' } : null,
		adding: form.adding,
		add_code: form.code,
		add_weight: {
			...weightField(
				{ blockId: block.block_id, field: 'learning.competencies.new' },
				form.weight,
				'learning.competencies.new'
			),
			label: 'Váha výstupu'
		},
		rename: form.rename,
		problem: form.problem
	};
}
