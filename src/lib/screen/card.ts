/**
 * The `card` region: the editor column as the teacher sees it. The open card with its
 * heading, chips and menu, each step with its fold state and the fields its type and
 * the mode show (with the value as displayed, the text typed that is no number yet, the
 * hint and the empty line), the answer table with its summary lines, and the sentence
 * that stands in the column when there is no card.
 *
 * `CardEditor`, `StepEditor` and `AnswerTable` render this and compute none of it: the
 * names, the chips, the XP, which rungs and columns the mode draws, which answers a
 * detail line is open for. What decides is in `domain/` (names, totals, the rules about
 * the app) and `ui/fields.ts` (which mode shows what).
 */
import { planQuestionTypeChange } from '$lib/domain/commands';
import {
	bindingFlagsPractice,
	blockDurationMinutes,
	derivedBlockXp,
	isPracticeBlock,
	optionOutcomesApply,
	stepPracticeOffered,
	stepSummary
} from '$lib/domain/derive';
import { isVideoPageLink, MIN_CHOICE_OPTIONS } from '$lib/domain/validate';
import { cardLabel, lessonLabel, stepName } from '$lib/domain/naming';
import { notANumberMessage as notANumber } from '$lib/domain/number-input';
import { refKey, type Ref } from '$lib/domain/ref';
import type {
	BlockStep,
	BlockType,
	BlockV2,
	QuestionOption,
	QuestionType,
	StepType
} from '$lib/domain/schema';
import { CARD_TYPE_LABELS } from '$lib/ui/card-type-labels';
import { allows, cardSettingsSummary, fieldSpec, fieldsFor } from '$lib/ui/fields';
import { uniqueKeys } from '$lib/ui/keys';
import { counted } from '$lib/ui/plural';
import { sectionTargeted } from '$lib/ui/settings-target';
import { stepIsExpanded } from '$lib/ui/step-expansion';
import { STEP_TYPE_LABELS } from '$lib/ui/step-type-labels';
import { asText, fieldViews, hiddenFields } from './field-view';
import { goToChoice, goToSummary } from './goto';
import { issueSets, shownAt } from './issues';
import type {
	AnswerRowView,
	AnswersView,
	AnswerSummaryPart,
	CardRegion,
	CardView,
	FieldView,
	QuestionView,
	ScreenInput,
	StepMediaView,
	StepView
} from './types';

/** What this card's type does to the student, as the type chip's tooltip says it. */
export const CARD_TYPE_TITLE: Record<BlockType, string> = {
	display: 'Typ karty: Výklad. Žák prochází kroky po jednom a mezi nimi kliká Pokračovat.',
	question:
		'Typ karty: Otázka. Kroky jsou v jedné bublině a žák je rovnou u otázky; další otázka se objeví, až odpoví na předchozí. Podle odpovědi ho lze poslat jinam.',
	exercise:
		'Typ karty: Cvičení — jedna karta uvnitř lekce. Jako Otázka, ale bez větvení. Nezaměňuj s typem celého kurzu „Cvičení“ v Nastavení kurzu ani se zařazením karty do denního opakování.'
};

/**
 * What a step does to the student depends on the card it is in, and that is the one
 * thing the two "Otázka" affordances never said. From `block_step_engine.dart`: a
 * `display` card draws one step per bubble and only as far as `_currentStepIndex`, so
 * a step is a stop the student taps through; a `question` or `exercise` card draws
 * `_buildExerciseCard()` — one bubble that grows as the student reaches each question
 * — and runs `_skipToNextQuestion()` on mount and after every answer, so content steps
 * are passive context and the student starts at the question. Branching (`go_to`) is
 * honoured for `question` and ignored for `exercise` (`step_navigation.dart`).
 *
 * So the same question is a pause inside a reading in one case and the whole point of
 * the card in the other — which is the choice a teacher is making here without being
 * told.
 */
export function stepAddTitle(blockType: BlockType, type: StepType): string {
	if (type !== 'question') {
		return blockType === 'display'
			? 'Samostatná zastávka: žák uvidí tenhle krok, klikne Pokračovat a teprve pak se objeví další.'
			: 'V téhle kartě není obsahový krok zastávka — zobrazí se v jedné bublině spolu s otázkou jako její zadání a žák jde rovnou odpovídat. Když se má žák zastavit a číst, patří text do karty typu Výklad.';
	}
	if (blockType === 'display') {
		return 'Otázka uvnitř výkladu: žák si přečte kroky nad ní, odpoví, a teprve pak se mu ukáže další krok. Slouží ke kontrole čtení. Má-li odpověď rozhodnout, co bude dál, udělej z otázky vlastní kartu typu Otázka — celou ji pak žák vidí jako jednu otázku a podle odpovědi ho lze poslat jinam.';
	}
	return blockType === 'exercise'
		? 'Další úloha v téže bublině. Po odpovědi žák pokračuje rovnou na ni; větvení se v kartě typu Cvičení ignoruje, pořadí je vždy stejné.'
		: 'Další otázka v téže bublině. Po odpovědi žák pokračuje rovnou na ni, nebo tam, kam ho pošle větvení u zvolené možnosti.';
}

const QUESTION_TYPES: { value: QuestionType; label: string; title: string }[] = [
	{ value: 'multiple_choice', label: 'Výběr', title: 'Žák vybírá z možností' },
	{ value: 'true_false', label: 'Ano/Ne', title: 'Dvě velká tlačítka — rychlé na procvičování' },
	{
		value: 'open',
		label: 'Otevřená odpověď',
		title: 'Žák píše odpověď; porovnává se bez ohledu na velikost písmen'
	},
	{ value: 'numeric', label: 'Číslo', title: 'Žák zadává číslo; vyhodnocuje se s tolerancí' }
];

/** The grades an answer can carry in a quiz. */
export const MARKS = [
	{ value: '', label: 'Bez známky' },
	...['1', '2', '3', '4', '5'].map((m) => ({ value: m, label: m }))
];

/** Fields a step or question shows where they are drawn by hand, not in the extras. */
const INLINE_STEP = ['content', 'image.url', 'image.alt', 'video.url', 'audio.url', 'hint', 'help'];
const INLINE_QUESTION = [
	'correct_answer',
	'correct_number',
	'tolerance',
	'allow_multiple',
	'solution'
];

/** A field a component draws by hand, with the same shape as a spec's. */
function field(
	spec: { label: string; hint?: string | null },
	over: Partial<FieldView> & Pick<FieldView, 'key' | 'value' | 'ref'>
): FieldView {
	return {
		level: 'step',
		path: over.key,
		label: spec.label,
		hint: spec.hint ?? null,
		kind: 'text',
		display: null,
		checked: null,
		empty_text: spec.label,
		options: null,
		numeric: false,
		draft: null,
		error: null,
		min: null,
		max: null,
		disabled: false,
		...over
	};
}

export function buildCard(input: ScreenInput): CardRegion {
	const { doc, open, mode } = input;
	const { lesson, card } = open;
	const hidden = hiddenFields(['block', 'step', 'question', 'option'], mode, input.showFeedback);
	if (lesson === undefined && card === undefined) {
		return {
			state: 'no_lesson',
			empty_text: 'Začni přidáním lekce vlevo.',
			card: null,
			hidden_fields: hidden
		};
	}
	if (card === undefined) {
		return {
			state: 'no_card',
			empty_text: `Lekce „${lesson === undefined ? '' : lessonLabel(doc, lesson)}“ zatím nemá kartu. Přidej ji v seznamu vlevo — bez karty žák v lekci nic neuvidí.`,
			card: null,
			hidden_fields: hidden
		};
	}
	return { state: 'card', empty_text: null, card: cardView(input, card), hidden_fields: hidden };
}

function cardView(input: ScreenInput, block: BlockV2): CardView {
	const { doc, open, mode } = input;
	const { lesson, binding, orphaned } = open;
	const lessonId = orphaned ? undefined : lesson?.lesson_id;
	const nameSpec = fieldSpec('block', 'name');

	const bound = doc.lessons.filter((l) => l.blocks.some((b) => b.block_id === block.block_id));
	const available = doc.lessons.filter((l) => !bound.includes(l));
	const minutes = blockDurationMinutes(block);
	const derived = derivedBlockXp(block);
	const authored = typeof block.xp === 'number' ? block.xp : undefined;
	const place =
		lessonId === undefined
			? -1
			: (doc.lessons
					.find((l) => l.lesson_id === lessonId)
					?.blocks.findIndex((b) => b.block_id === block.block_id) ?? -1);
	const lessonCards = doc.lessons.find((l) => l.lesson_id === lessonId)?.blocks.length ?? 0;

	const keys = uniqueKeys(block.steps.map((s) => s.id));
	const sets = issueSets(input.validation, input.showFeedback, input.touched, input.reviewed);

	return {
		block_id: block.block_id,
		type: block.type,
		type_label: CARD_TYPE_LABELS[block.type],
		type_title: CARD_TYPE_TITLE[block.type],
		orphan_text: orphaned ? 'Karta mimo lekce — žák se k ní nedostane' : null,
		heading: {
			label: nameSpec?.label ?? 'Název karty',
			hint: nameSpec?.hint ?? null,
			value: block.name ?? '',
			placeholder: cardLabel(doc, block, { lessonId: lesson?.lesson_id, max: 70 })
		},
		chips: {
			practice: isPracticeBlock(block, bindingFlagsPractice(doc, block.block_id))
				? {
						text: 'Opakování',
						title:
							'Karta je zařazená do denního opakování (Cvičení) — žák ji dostane znovu podle plánu opakování. S typem karty to nesouvisí; zapíná se v Nastavení karty.'
					}
				: null,
			shared:
				bound.length > 1
					? {
							text: `Sdílený: ${counted(bound.length, 'lekce', 'lekce', 'lekcí')}`,
							title: 'Blok je i v jiné lekci — úprava se projeví všude'
						}
					: null,
			minutes:
				minutes === undefined ? null : { text: `${minutes} min`, title: 'Očekávaný čas na kartu' },
			// What the app awards is what the steps are worth; a card's own `xp` is read by
			// nothing there (OPEN-PROBLEMS #15), so it is not the reward the chip shows.
			xp: {
				text: `${derived} XP`,
				title:
					`Dopočteno z kroků: 8 XP za každý krok s otázkou, 1 XP za obsahový krok (${derived} XP). Platí hned, i když je karta ještě rozepsaná.` +
					(authored === undefined
						? ''
						: ` Zadaná hodnota (${authored} XP) se v aplikaci nepoužije: žák dostane XP z kroků.`)
			}
		},
		settings_title: cardSettingsSummary(mode, input.showFeedback),
		menu: {
			assign:
				bound.length === 0
					? {
							disabled: available.length === 0,
							title:
								available.length === 0
									? 'Nejprve vytvoř lekci'
									: 'Zařadit existující kartu do lekce bez kopírování obsahu'
						}
					: null,
			remove_from_lesson:
				bound.length > 0 && binding !== undefined && lessonId !== undefined
					? {
							title:
								bound.length > 1
									? 'Odebere kartu jen z této lekce — ostatní lekce a všechen obsah zůstanou'
									: 'Odebere kartu z této lekce. Obsah zůstává v části Karty mimo lekci; smazat jde přes Smazat kartu.'
						}
					: null,
			move:
				place >= 0 ? { up_disabled: place === 0, down_disabled: place >= lessonCards - 1 } : null
		},
		add_step: (Object.keys(STEP_TYPE_LABELS) as StepType[]).map((type) => ({
			type,
			label: STEP_TYPE_LABELS[type],
			title: stepAddTitle(block.type, type)
		})),
		steps: block.steps.map((step, i) => stepView(input, sets.shown, block, step, keys[i], i))
	};
}

type Shown = {
	errors: import('$lib/domain/validate').Issue[];
	warnings: import('$lib/domain/validate').Issue[];
};

function stepView(
	input: ScreenInput,
	shown: Shown,
	block: BlockV2,
	step: BlockStep,
	key: string,
	i: number
): StepView {
	const { doc, mode } = input;
	const feedbackOn = input.showFeedback;
	const showIds = allows('step', 'id', mode);
	const scope: Ref = { blockId: block.block_id, stepId: step.id };
	const position = i + 1;
	const targeted =
		input.selection?.blockId === block.block_id && input.selection?.stepId === step.id;
	const issues = shownAt(shown, scope);
	const filled = (text: string | undefined) => (text ?? '').trim() !== '';

	// "This card has no text" is addressed to the card, but the place to fix it is an
	// empty text step — so that is where it shows, once the card has been left.
	const missing =
		step.type === 'text' && !filled(step.content)
			? shownAt(shown, { blockId: block.block_id }).errors.find(
					(issue) => issue.code === 'E_DISPLAY_NO_TEXT'
				)
			: undefined;

	const extraFields = fieldsFor('step', mode, feedbackOn).filter(
		(f) =>
			!INLINE_STEP.includes(f.path) &&
			// The step's switch only duplicates the card's own when the card is in practice.
			(f.path !== 'default_practice' || stepPracticeOffered(doc, block, step)) &&
			// Where a picture or video sits matters only on a step that has one.
			(f.path !== 'image.position' || step.type === 'image' || step.image !== undefined) &&
			(f.path !== 'video.position' || step.type === 'video' || step.video !== undefined)
	);
	const questionExtras = fieldsFor('question', mode, feedbackOn).filter(
		(f) => !INLINE_QUESTION.includes(f.path)
	);
	const stepContext = { root: step, scope, drafts: input.drafts };
	const questionContext = { root: step.question, scope, drafts: input.drafts };

	const ladderReached = block.type === 'display' || step.type === 'question';
	const ladderShown = ladderReached || filled(step.hint) || filled(step.help);
	const showLadder = allows('step', 'hint', mode, feedbackOn);
	const hintSpec = fieldSpec('step', 'hint');
	const helpSpec = fieldSpec('step', 'help');
	const cardHasHint = filled(block.hint);

	return {
		key,
		id: step.id,
		position,
		name: stepName(block, step, { showIds }),
		type: step.type,
		type_label: STEP_TYPE_LABELS[step.type],
		name_title: showIds ? 'Identifikátor kroku' : null,
		inbound_branches:
			input.index.referencesToStep.get(`${block.block_id}::${step.id}`)?.length ?? 0,
		summary: stepSummary(step),
		expanded: stepIsExpanded(input.steps, block.block_id, key, step.id, input.selection),
		targeted,
		invalid: issues.errors.length > 0,
		grip_label: `Přesunout krok ${position}`,
		body_label: `Obsah kroku ${position}`,
		insert_label: `Vložit krok za krok ${position}`,
		move: { up_disabled: i <= 0, down_disabled: i >= block.steps.length - 1 },
		content:
			step.type === 'text' || step.type === 'question'
				? {
						value: step.content ?? '',
						placeholder: step.type === 'text' ? 'Napiš, co si má žák přečíst.' : 'Zadání otázky',
						missing_text: missing?.message ?? null
					}
				: null,
		media: mediaView(step, scope),
		question: step.type === 'question' ? questionView(input, shown, block, step, key) : null,
		ladder:
			showLadder && ladderShown
				? {
						hint: field(
							{ label: hintSpec?.label ?? 'Nápověda', hint: hintSpec?.hint },
							{
								key: 'hint',
								kind: 'multiline',
								value: asText(step.hint),
								empty_text: cardHasHint
									? 'nevyplněno — otazník u tohoto kroku otevře nápovědu ke kartě'
									: 'nevyplněno — bez nápovědy žák u tohoto kroku otazník neuvidí',
								ref: { ...scope, field: 'hint' }
							}
						),
						help: field(
							{ label: helpSpec?.label ?? 'Podrobná pomoc', hint: helpSpec?.hint },
							{
								key: 'help',
								kind: 'multiline',
								value: asText(step.help),
								empty_text: 'nevyplněno — druhá úroveň otazníku',
								ref: { ...scope, field: 'help' }
							}
						)
					}
				: null,
		extras:
			extraFields.length > 0 || questionExtras.length > 0
				? {
						label: 'Další nastavení kroku',
						targeted: sectionTargeted(
							{ selection: input.selection, shown },
							['step', 'question'],
							'extras',
							scope
						),
						fields: fieldViews(extraFields, stepContext),
						question_fields:
							step.type === 'question' ? fieldViews(questionExtras, questionContext) : []
					}
				: null
	};
}

function mediaView(step: BlockStep, scope: Ref): StepMediaView | null {
	const media = (
		kind: 'image' | 'video' | 'audio',
		label: string,
		empty: string,
		url: string | undefined
	) =>
		field(
			{ label },
			{
				key: `${kind}.url`,
				value: asText(url),
				empty_text: empty,
				ref: { ...scope, field: `${kind}.url` }
			}
		);
	if (step.type === 'image') {
		const url = step.image?.url;
		return {
			kind: 'image',
			url: media(
				'image',
				'Adresa obrázku',
				'Vlož odkaz na obrázek (např. https://…/obrazek.jpg)',
				url
			),
			// Nothing to describe until there is a picture.
			alt:
				(url ?? '') === ''
					? null
					: field(
							{ label: 'Popis obrázku pro čtečku obrazovky' },
							{
								key: 'image.alt',
								value: asText(step.image?.alt),
								empty_text: 'Popiš, co je na obrázku — přečte to čtečka obrazovky',
								ref: { ...scope, field: 'image.alt' }
							}
						),
			page_link_warning: null
		};
	}
	if (step.type === 'video') {
		return {
			kind: 'video',
			url: media(
				'video',
				'Adresa videa',
				'https://… přímý odkaz na MP4 (YouTube a Vimeo přehrávač nenačte)',
				step.video?.url
			),
			alt: null,
			// §14 E_MEDIA_NOT_DIRECT fires on export, but by then the teacher has already
			// pasted the wrong thing and moved on: said here, by the same rule.
			page_link_warning: isVideoPageLink(step.video?.url)
				? 'Tohle je odkaz na stránku YouTube/Vimeo, ne na video samotné — přehrávač v kurzu ho nenačte. Otevři video, najdi jeho přímý soubor (.mp4) a vlož adresu toho.'
				: null
		};
	}
	if (step.type === 'audio') {
		return {
			kind: 'audio',
			url: media('audio', 'Adresa zvuku', 'https://… MP3, WAV nebo OGG', step.audio?.url),
			alt: null,
			page_link_warning: null
		};
	}
	return null;
}

function questionView(
	input: ScreenInput,
	shown: Shown,
	block: BlockV2,
	step: BlockStep,
	stepKey: string
): QuestionView {
	const { mode } = input;
	const question = step.question;
	const scope: Ref = { blockId: block.block_id, stepId: step.id };
	const type = question?.type ?? 'multiple_choice';
	const multipleSpec = fieldSpec('question', 'allow_multiple');
	const typed = (path: string, label: string, empty: string, value: unknown): FieldView =>
		field(
			{ label },
			{
				key: `question.${path}`,
				level: 'question',
				path,
				value: asText(value),
				empty_text: empty,
				ref: { ...scope, field: `question.${path}` }
			}
		);
	const numberField = (path: 'correct_number' | 'tolerance', label: string, empty: string) => {
		const base = typed(path, label, empty, question?.[path]);
		const draft = input.drafts[refKey(base.ref)];
		return {
			...base,
			kind: 'number' as const,
			draft: draft ?? null,
			error: draft === undefined ? null : notANumber(draft)
		};
	};
	return {
		type,
		types: QUESTION_TYPES.map((t) => ({
			...t,
			confirm: planQuestionTypeChange(question, t.value) !== null
		})),
		correct_answer:
			type === 'open'
				? typed(
						'correct_answer',
						'Správná odpověď',
						'Jedno slovo nebo číslo — porovnává se bez ohledu na velikost písmen',
						question?.correct_answer
					)
				: null,
		correct_number:
			type === 'numeric' ? numberField('correct_number', 'Správný výsledek', 'Číslo') : null,
		tolerance:
			type === 'numeric'
				? numberField('tolerance', 'Tolerance', '0 — vyžaduje přesnou shodu')
				: null,
		answers:
			type === 'multiple_choice' || type === 'true_false'
				? answersView(input, shown, block, step, stepKey)
				: null,
		multiple:
			type === 'multiple_choice'
				? {
						...typed('allow_multiple', multipleSpec?.label ?? 'Víc správných možností', '', ''),
						kind: 'toggle',
						checked: question?.allow_multiple === true,
						hint: question?.allow_multiple === true ? (multipleSpec?.hint ?? null) : null
					}
				: null,
		solution: allows('question', 'solution', mode, input.showFeedback)
			? {
					...typed(
						'solution',
						'Vysvětlení řešení',
						'Napiš postup, ne jen výsledek — tohle je nejčtenější text v kurzu.',
						question?.solution
					),
					kind: 'multiline'
				}
			: null
	};
}

function answersView(
	input: ScreenInput,
	shown: Shown,
	block: BlockV2,
	step: BlockStep,
	stepKey: string
): AnswersView {
	const { doc, mode } = input;
	const question = step.question;
	const options = question?.options ?? [];
	// Duplicate option ids are a warning (`W_DUPLICATE_OPTION_ID`), not a crash.
	const optionKeys = uniqueKeys(options.map((o) => o.id));
	// The app reads an answer's "Kam dál" and grade only when the pupil picks one answer
	// (`optionOutcomesApply`), so a question with several picks has neither.
	const outcomes = optionOutcomesApply(question);
	const branching = outcomes && block.type === 'question' && doc.export_type !== 'exercise_v2';
	const quizMarks = outcomes && (doc.export_type === 'quiz_v2' || doc.quiz_evaluate === true);
	const advanced = allows('option', 'score_koef', mode);
	// Zpětná vazba off: the column that tells the pupil what went wrong goes, and its
	// track with it — the rest of the row keeps its alignment.
	const feedback = allows('option', 'feedback', mode, input.showFeedback);
	const fixed = question?.type === 'true_false';
	// A true/false pair has no order to change.
	const movable = !fixed && options.length > 1;
	// The detail line exists only when at least one of its fields does.
	const detailOffered = branching || quizMarks || advanced || movable;
	const showIds = allows('step', 'id', mode);
	// The last answers have to stay: a question with nothing to choose from is not a
	// question (`E_MC_TOO_FEW_OPTIONS`, which `MIN_CHOICE_OPTIONS` bounds).
	const lastAnswers = question?.type === 'multiple_choice' && options.length <= MIN_CHOICE_OPTIONS;
	const scope: Ref = { blockId: block.block_id, stepId: step.id };
	const listIssues = shownAt(shown, { ...scope, field: 'question.options' });

	const summaryOf = (option: QuestionOption): AnswerSummaryPart[] => {
		const parts: AnswerSummaryPart[] = [];
		if (branching) {
			const where = goToSummary(doc, block, option.go_to, showIds, input.index);
			if (where !== '') parts.push({ text: where, branch: true });
		}
		if (quizMarks && option.mark !== undefined && option.mark !== '') {
			parts.push({ text: `známka ${option.mark}`, branch: false });
		}
		if (advanced && option.score_koef !== undefined) {
			parts.push({ text: `podíl bodů ${option.score_koef}`, branch: false });
		}
		return parts;
	};

	const rows = options.map((option, i): AnswerRowView => {
		const optionRef = (name: string): Ref => ({ ...scope, optionId: option.id, field: name });
		const key = optionKeys[i];
		const name = option.text || 'bez textu';
		const text = field(
			{ label: 'Text odpovědi' },
			{
				key: 'text',
				level: 'option',
				value: asText(option.text),
				empty_text: 'Napiš odpověď…',
				disabled: fixed,
				ref: optionRef('text')
			}
		);
		const scoreRef = optionRef('score_koef');
		const scoreDraft = input.drafts[refKey(scoreRef)];
		return {
			key,
			id: option.id,
			correct: option.is_correct === true,
			correct_label: `Správná odpověď: ${name}`,
			correct_title: option.is_correct
				? 'Správná odpověď — klikni pro označení jako chybná'
				: 'Chybná odpověď — klikni pro označení jako správná',
			text,
			summary: summaryOf(option),
			feedback: feedback
				? field(
						{ label: 'Zpětná vazba k této odpovědi' },
						{
							key: 'feedback',
							level: 'option',
							kind: 'multiline',
							value: asText(option.feedback),
							empty_text:
								option.is_correct === true
									? 'Potvrď, proč je to správně…'
									: 'Pojmenuj chybu, která k této odpovědi vede…',
							ref: optionRef('feedback')
						}
					)
				: null,
			open: input.ui.openDetails.has(`${block.block_id}/${stepKey}/${key}`),
			more_label: `Podrobnosti odpovědi ${name}`,
			trash: fixed
				? null
				: {
						disabled: lastAnswers,
						title: lastAnswers
							? 'Otázka potřebuje aspoň dvě odpovědi, ze kterých žák vybírá'
							: 'Smazat odpověď',
						label: `Smazat odpověď ${name}`
					},
			pointed: detailOffered
				? sectionTargeted({ selection: input.selection, shown }, ['option'], 'detail', {
						...scope,
						optionId: option.id
					})
				: false,
			detail: {
				branch: branching
					? {
							picker_id: `goto:${refKey({ ...scope, optionId: option.id, field: 'go_to' })}`,
							shown: goToChoice(doc, input.index, block, step.id, option.go_to, showIds).shown
						}
					: null,
				marks: quizMarks ? { value: option.mark ?? '', options: MARKS } : null,
				order: movable
					? {
							up_disabled: i === 0,
							down_disabled: i === options.length - 1,
							up_label: `Posunout nahoru: ${option.text || 'odpověď bez textu'}`,
							down_label: `Posunout dolů: ${option.text || 'odpověď bez textu'}`
						}
					: null,
				score: advanced
					? {
							...field(
								{ label: 'Podíl bodů za tuto odpověď' },
								{
									key: 'score_koef',
									level: 'option',
									kind: 'number',
									value: asText(option.score_koef),
									empty_text: '1.0',
									ref: scoreRef
								}
							),
							draft: scoreDraft ?? null,
							error: scoreDraft === undefined ? null : notANumber(scoreDraft)
						}
					: null
			}
		};
	});

	return {
		headed: feedback,
		feedback_column: feedback,
		tracks: [
			'36px',
			'minmax(0, 1.4fr)',
			...(feedback ? ['minmax(0, 1.6fr)'] : []),
			detailOffered ? '4.25rem' : '2rem'
		].join(' '),
		fixed,
		detail_offered: detailOffered,
		rows,
		list_issues: [...listIssues.errors, ...listIssues.warnings].map((issue) => ({
			severity: issue.severity,
			message: issue.message
		})),
		can_add: !fixed
	};
}
