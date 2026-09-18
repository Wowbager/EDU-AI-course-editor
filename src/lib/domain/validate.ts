/**
 * Validation — spec §14, implemented as a pure function. No UI in this module.
 *
 * Errors block export, warnings never do (§3 invariant 5). The split is exactly the
 * one §14 draws; nothing here promotes or demotes a rule.
 *
 * Messages are Czech and written as consequences for the student, because that is
 * what makes an author fix them: "žák se nedozví, kde udělal chybu" lands, a field
 * name does not.
 *
 * A message never names a place by its `block_id` / step or option `id` — a teacher
 * is never shown one (plan §8). `naming.ts` is the one place that turns an id back
 * into what the teacher actually sees (a card's own text, "Krok 3", an answer's own
 * text), and every check below goes through it instead of interpolating an id
 * directly. The one exception is a genuinely id-shaped bug — two things sharing one
 * id, or a reference to an id nothing carries — where the id itself is what is wrong
 * and has to stay on screen, alongside a human name so the teacher can find the
 * place.
 */
import type { BlockStep, BlockV2, CourseV2, QuestionConfig } from './schema';
import type { Ref } from './ref';
import { buildIndex, isGoToKeyword, reachableSteps, type DocIndex } from './index-doc';
import { blockDurationMinutes, isPracticeBlock } from './derive';
import { dimensionCount, ELO_MAX, ELO_MIN, type SkillConfig } from './skill-config';
import { blockLabel, capitalize, lessonLabel, optionLabel, stepLabel, stepPosition } from './naming';

export type Severity = 'error' | 'warning';

export interface Issue {
	code: string;
	severity: Severity;
	ref: Ref;
	message: string;
}

export interface ValidationResult {
	errors: Issue[];
	warnings: Issue[];
}

export interface ValidateOptions {
	/** The last published version, for the "not bumped" warning (§14 warning 1). */
	lastPublishedVersion?: number;
}

export function validate(
	doc: CourseV2,
	skillConfig?: SkillConfig | null,
	options: ValidateOptions = {}
): ValidationResult {
	const index = buildIndex(doc);
	const issues: Issue[] = [];
	const add = (
		severity: Severity,
		code: string,
		ref: Ref,
		message: string
	) => issues.push({ code, severity, ref, message });

	checkUniqueIds(doc, add);
	checkBindings(doc, index, add);
	checkBlocks(doc, index, skillConfig, add);
	checkPrerequisiteGraph(doc, index, add);
	checkCourseLevel(doc, index, options, add);

	return {
		errors: issues.filter((i) => i.severity === 'error'),
		warnings: issues.filter((i) => i.severity === 'warning')
	};
}

type Add = (severity: Severity, code: string, ref: Ref, message: string) => void;

// ───────────────────────────── §14.2 referential integrity ─────────────────────────────

function checkUniqueIds(doc: CourseV2, add: Add) {
	const seenLessons = new Set<string>();
	for (const lesson of doc.lessons) {
		if (seenLessons.has(lesson.lesson_id)) {
			// The first lesson with this id, so both duplicates can be named — the id
			// is what is actually broken here (§3 invariant "ids are unique"), so it
			// stays on screen too, next to both human names.
			const first = doc.lessons.find((l) => l.lesson_id === lesson.lesson_id)!;
			add('error', 'E_DUPLICATE_LESSON_ID', { lessonId: lesson.lesson_id, field: 'lesson_id' },
				`Dvě lekce — „${lessonLabel(doc, first)}“ a „${lessonLabel(doc, lesson)}“ — mají stejné id „${lesson.lesson_id}“. Postup žáka se ukládá pod tímto id, takže by se obě lekce navzájem přepisovaly.`);
		}
		seenLessons.add(lesson.lesson_id);
	}

	const seenBlocks = new Set<string>();
	for (const block of doc.blocks) {
		if (seenBlocks.has(block.block_id)) {
			const first = doc.blocks.find((b) => b.block_id === block.block_id)!;
			add('error', 'E_DUPLICATE_BLOCK_ID', { blockId: block.block_id, field: 'block_id' },
				`Dva bloky — „${blockLabel(doc, first)}“ a „${blockLabel(doc, block)}“ — mají stejné id „${block.block_id}“. Žákovi by se zobrazil jen jeden z nich a odkazy na ten druhý by nikam nevedly.`);
		}
		seenBlocks.add(block.block_id);

		const seenSteps = new Set<string>();
		for (const step of block.steps) {
			if (seenSteps.has(step.id)) {
				const first = block.steps.find((s) => s.id === step.id)!;
				add('error', 'E_DUPLICATE_STEP_ID', { blockId: block.block_id, stepId: step.id, field: 'id' },
					`Blok „${blockLabel(doc, block)}“ má dva kroky se stejným id „${step.id}“ — ${stepLabel(block, first)} a ${stepLabel(block, step)}. Odpověď žáka se uloží k jednomu z nich a větvení skočí na nesprávný krok.`);
			}
			seenSteps.add(step.id);

			const seenOptions = new Set<string>();
			for (const option of step.question?.options ?? []) {
				if (seenOptions.has(option.id)) {
					const first = (step.question?.options ?? []).find((o) => o.id === option.id)!;
					add('warning', 'W_DUPLICATE_OPTION_ID',
						{ blockId: block.block_id, stepId: step.id, optionId: option.id, field: 'id' },
						`V bloku „${blockLabel(doc, block)}“ (${stepLabel(block, step)}) mají dvě odpovědi stejné id „${option.id}“ — ${optionLabel(step.question, first)} a ${optionLabel(step.question, option)}. Žákova volba se může uložit k té druhé a vyhodnotit se jinak, než čekáš.`);
				}
				seenOptions.add(option.id);
			}
		}
	}
}

function checkBindings(doc: CourseV2, index: DocIndex, add: Add) {
	for (const lesson of doc.lessons) {
		const lessonName = lessonLabel(doc, lesson);

		for (const binding of lesson.blocks) {
			if (!index.blocksById.has(binding.block_id)) {
				// The target itself resolves to nothing this course has, so there is no
				// human name to give it — the id is the only thing left to point at.
				add('error', 'E_BINDING_UNRESOLVED',
					{ lessonId: lesson.lesson_id, blockId: binding.block_id, field: 'block_id' },
					`Lekce „${lessonName}“ odkazuje na blok „${binding.block_id}“, který v kurzu není. Žák uvidí lekci kratší, než jsi zamýšlel/a.`);
			}
		}

		if (lesson.blocks.length > 12) {
			add('warning', 'W_LESSON_TOO_LONG', { lessonId: lesson.lesson_id },
				`Lekce „${lessonName}“ má ${lesson.blocks.length} bloků. Žák ji pravděpodobně nedokončí na jeden zátah — zvaž rozdělení.`);
		}

		// §14 warning 2 — partial duration coverage makes the lesson time wrong.
		let withDuration = 0;
		let resolved = 0;
		for (const binding of lesson.blocks) {
			const block = index.blocksById.get(binding.block_id);
			if (block === undefined) continue;
			resolved++;
			const minutes = blockDurationMinutes(block);
			if (minutes !== undefined && minutes > 0) withDuration++;
		}
		if (withDuration > 0 && withDuration < resolved) {
			add('warning', 'W_PARTIAL_DURATION', { lessonId: lesson.lesson_id, field: 'duration' },
				`V lekci „${lessonName}“ má délku vyplněno jen ${withDuration} z ${resolved} bloků. Na kartě lekce se žákovi ukáže součet jen z nich, takže čas bude výrazně nižší než skutečný.`);
		}
	}
}

// ───────────────────────────────── blocks and steps ─────────────────────────────────

function checkBlocks(doc: CourseV2, index: DocIndex, skillConfig: SkillConfig | null | undefined, add: Add) {
	const exerciseCourse = doc.export_type === 'exercise_v2';
	const courseEloMean = meanElo(doc);

	for (const block of doc.blocks) {
		const blockRef: Ref = { blockId: block.block_id };
		const cardName = blockLabel(doc, block);

		checkStructuralCompleteness(doc, block, add);
		checkVectors(doc, block, skillConfig, add);

		if (block.steps.length > 10) {
			add('warning', 'W_BLOCK_TOO_MANY_STEPS', blockRef,
				`Blok „${cardName}“ má ${block.steps.length} kroků. Žák ztrácí přehled, kde v něm je — zvaž rozdělení na dva bloky.`);
		}

		// §14 warning 5 — a block nothing reaches is a block no student ever sees.
		const referenced = (index.referencesToBlock.get(block.block_id) ?? []).length > 0;
		if (!referenced && !isPracticeBlock(block)) {
			add('warning', 'W_ORPHAN_BLOCK', blockRef,
				`Blok „${cardName}“ není v žádné lekci, nevede na něj žádné větvení ani není zařazen do cvičení. Žák se k němu nedostane.`);
		}

		const reachable = reachableSteps(block);
		for (const step of block.steps) {
			const stepRef: Ref = { blockId: block.block_id, stepId: step.id };
			checkMedia(block, step, add);

			if (!reachable.has(step.id)) {
				add('warning', 'W_UNREACHABLE_STEP', stepRef,
					`${capitalize(stepLabel(block, step))} v bloku „${cardName}“ není z ničeho dosažitelný — nevede k němu žádná cesta ani větvení. Žák jej nikdy neuvidí.`);
			}

			const question = step.question;
			if (question === undefined) continue;

			checkGoToTargets(index, block, step, question, exerciseCourse, add);
			checkFeedbackQuality(block, step, question, add);
		}

		checkEloOutlier(doc, block, courseEloMean, add);
	}
}

function checkStructuralCompleteness(doc: CourseV2, block: BlockV2, add: Add) {
	const blockRef: Ref = { blockId: block.block_id };
	const cardName = blockLabel(doc, block);

	if (block.type === 'display') {
		const hasText = block.steps.some(
			(s) => s.type === 'text' && typeof s.content === 'string' && s.content.trim() !== ''
		);
		const hasMedia = block.steps.some((s) => s.type === 'image' || s.type === 'video' || s.type === 'audio');
		if (!hasText && !hasMedia) {
			add('error', 'E_DISPLAY_NO_TEXT', blockRef,
				`Výkladový blok „${cardName}“ nemá žádný text. Žákovi se otevře prázdná karta.`);
		}
	} else {
		const questionSteps = block.steps.filter((s) => s.type === 'question');
		if (questionSteps.length === 0) {
			add('error', 'E_QUESTION_NO_QUESTION_STEP', blockRef,
				`Blok „${cardName}“ je typu ${block.type === 'exercise' ? 'cvičení' : 'otázka'}, ale neobsahuje žádnou otázku. Žák nemá co odpovědět a blok nelze dokončit.`);
		}
		for (const step of questionSteps) {
			if (step.question === undefined) {
				add('error', 'E_QUESTION_STEP_NO_CONFIG', { blockId: block.block_id, stepId: step.id },
					`${capitalize(stepLabel(block, step))} v bloku „${cardName}“ je otázka, ale nemá zadané zadání ani odpovědi. Žák uvidí prázdnou otázku.`);
			}
		}
	}

	for (const step of block.steps) {
		const question = step.question;
		if (question === undefined) continue;
		checkQuestionShape(block, step, question, add);
	}
}

/** §14.1 — every question type's structural requirements. */
function checkQuestionShape(block: BlockV2, step: BlockStep, question: QuestionConfig, add: Add) {
	const ref: Ref = { blockId: block.block_id, stepId: step.id };
	const position = stepPosition(block, step);
	const options = question.options ?? [];
	const correct = options.filter((o) => o.is_correct === true);

	switch (question.type) {
		case 'open': {
			const answer = question.correct_answer;
			if (typeof answer !== 'string' || answer.trim() === '') {
				add('error', 'E_OPEN_NO_CORRECT_ANSWER', { ...ref, field: 'question.correct_answer' },
					`Otevřená otázka v kroku ${position} nemá zadanou správnou odpověď. Žákovi se každá odpověď vyhodnotí jako chybná.`);
			}
			break;
		}
		case 'numeric': {
			if (typeof question.correct_number !== 'number') {
				add('error', 'E_NUMERIC_NO_CORRECT_NUMBER', { ...ref, field: 'question.correct_number' },
					`Číselná otázka v kroku ${position} nemá zadaný správný výsledek. Žákovi se každá odpověď vyhodnotí jako chybná.`);
			}
			break;
		}
		case 'true_false': {
			if (options.length !== 2) {
				add('error', 'E_TF_OPTION_COUNT', { ...ref, field: 'question.options' },
					`Otázka ano/ne v kroku ${position} má ${options.length} možnost(í) místo dvou. Žákovi se nezobrazí obě tlačítka.`);
			}
			if (correct.length !== 1) {
				add('error', 'E_TF_CORRECT_COUNT', { ...ref, field: 'question.options' },
					`Otázka ano/ne v kroku ${position} má ${correct.length} správných odpovědí místo jedné. Vyhodnocení pro žáka nedá smysl.`);
			}
			break;
		}
		case 'multiple_choice': {
			if (options.length < 2) {
				add('error', 'E_MC_TOO_FEW_OPTIONS', { ...ref, field: 'question.options' },
					`Otázka v kroku ${position} má jen ${options.length} možnost(í). Žák nemá z čeho vybírat.`);
			}
			if (correct.length === 0 && question.show_answers !== false) {
				add('error', 'E_MC_NO_CORRECT', { ...ref, field: 'question.options' },
					`Otázka v kroku ${position} nemá označenou žádnou správnou odpověď. Ať žák zvolí cokoli, dozví se, že chyboval.`);
			}
			for (const option of options) {
				if (typeof option.text !== 'string' || option.text.trim() === '') {
					add('error', 'E_MC_EMPTY_OPTION_TEXT', { ...ref, optionId: option.id, field: 'text' },
						`${capitalize(optionLabel(question, option))} v kroku ${position} nemá text. Žákovi se zobrazí prázdné tlačítko.`);
				}
			}
			break;
		}
	}
}

/** §14.2 — every `go_to` resolves; §14 warning 3 — branching inside a drill is ignored. */
function checkGoToTargets(
	index: DocIndex,
	block: BlockV2,
	step: BlockStep,
	question: QuestionConfig,
	exerciseCourse: boolean,
	add: Add
) {
	const ownSteps = index.stepsByBlock.get(block.block_id);
	const position = stepPosition(block, step);

	for (const option of question.options ?? []) {
		const target = option.go_to;
		if (typeof target !== 'string' || target === '') continue;
		const ref: Ref = { blockId: block.block_id, stepId: step.id, optionId: option.id, field: 'go_to' };
		const optionName = capitalize(optionLabel(question, option));

		if (block.type === 'exercise' || exerciseCourse) {
			add('warning', 'W_GOTO_IN_EXERCISE', ref,
				exerciseCourse
					? `${optionName} v kroku ${position} má nastavené větvení, ale celý kurz je typu cvičení — žák bude vždy pokračovat dál a na připravenou nápravu se nedostane.`
					: `${optionName} v kroku ${position} má nastavené větvení, ale blok je typu cvičení — žák bude vždy pokračovat dál a na připravenou nápravu se nedostane.`);
			continue;
		}

		if (isGoToKeyword(target)) continue;
		if (ownSteps?.has(target)) continue;
		if (index.blocksById.has(target)) continue;

		// The target itself is what is broken — it names neither a step of this block
		// nor a block in the course — so there is nothing to resolve it to.
		add('error', 'E_GOTO_UNRESOLVED', ref,
			`${optionName} v kroku ${position} vede na „${target}“, což není krok tohoto bloku ani blok v tomto kurzu. Žák, který ji zvolí, uvízne.`);
	}
}

function checkFeedbackQuality(block: BlockV2, step: BlockStep, question: QuestionConfig, add: Add) {
	const options = question.options ?? [];
	const wrong = options.filter((o) => o.is_correct !== true);
	const position = stepPosition(block, step);

	// §14 warning 9
	if (
		wrong.length > 0 &&
		question.show_answers !== false &&
		!wrong.some((o) => typeof o.feedback === 'string' && o.feedback.trim() !== '')
	) {
		add('warning', 'W_NO_WRONG_OPTION_FEEDBACK',
			{ blockId: block.block_id, stepId: step.id, field: 'question.options' },
			`Žádná chybná odpověď v kroku ${position} nemá zpětnou vazbu. Žák se nedozví, kde udělal chybu — jen že chyboval.`);
	}

	// §14 warning 10
	for (const option of options) {
		if (option.is_correct !== true && typeof option.score_koef === 'number' && option.score_koef > 0) {
			add('warning', 'W_PARTIAL_CREDIT_ON_WRONG',
				{ blockId: block.block_id, stepId: step.id, optionId: option.id, field: 'score_koef' },
				`${capitalize(optionLabel(question, option))} v kroku ${position} je označená jako chybná, ale dává žákovi ${Math.round(option.score_koef * 100)} % bodů. Pokud to tak má být, je to v pořádku — jinak dostane víc XP, než si zaslouží.`);
		}
	}
}

/** §14.5 — media must be playable for the student. */
function checkMedia(block: BlockV2, step: BlockStep, add: Add) {
	const ref: Ref = { blockId: block.block_id, stepId: step.id };
	const position = stepPosition(block, step);

	// A brand-new media step starts with `url: ''` (`addStep` in commands.ts) — the
	// same situation as a text step with no content, and just as invisible to the
	// student, so it is an error for the same reason `E_DISPLAY_NO_TEXT` is: nothing
	// renders in its place. The wording stays a plain statement of fact ("zatím
	// nemá") rather than a complaint, because this fires the moment the step is
	// added, before the author has had a chance to paste anything in.
	if (step.type === 'video' && (step.video?.url ?? '').trim() === '') {
		add('error', 'E_VIDEO_NO_URL', { ...ref, field: 'video.url' },
			`Video v kroku ${position} zatím nemá žádnou adresu. Dokud ji nevyplníš, žákovi se na jeho místě nezobrazí nic.`);
	}
	if (step.type === 'image' && (step.image?.url ?? '').trim() === '') {
		add('error', 'E_IMAGE_NO_URL', { ...ref, field: 'image.url' },
			`Obrázek v kroku ${position} zatím nemá žádnou adresu. Dokud ji nevyplníš, žákovi se na jeho místě nezobrazí nic.`);
	}
	if (step.type === 'audio' && (step.audio?.url ?? '').trim() === '') {
		add('error', 'E_AUDIO_NO_URL', { ...ref, field: 'audio.url' },
			`Zvuk v kroku ${position} zatím nemá žádnou adresu. Dokud ji nevyplníš, žákovi se na jeho místě nic nepřehraje.`);
	}

	const video = step.video?.url;
	if (typeof video === 'string' && video !== '') {
		if (/youtube\.com|youtu\.be|vimeo\.com/i.test(video)) {
			add('error', 'E_MEDIA_NOT_DIRECT', { ...ref, field: 'video.url' },
				`Video v kroku ${position} odkazuje na stránku YouTube nebo Vimeo. Přehrávač potřebuje přímý odkaz na MP4 — takto se žákovi nepřehraje nic.`);
		}
		checkHttps(video, { ...ref, field: 'video.url' }, `Video v kroku ${position}`, add);
	}

	const image = step.image?.url;
	if (typeof image === 'string' && image !== '') {
		checkHttps(image, { ...ref, field: 'image.url' }, `Obrázek v kroku ${position}`, add);
	}
	const audio = step.audio?.url;
	if (typeof audio === 'string' && audio !== '') {
		checkHttps(audio, { ...ref, field: 'audio.url' }, `Zvuk v kroku ${position}`, add);
	}
	const solutionImage = step.question?.solution_image?.url;
	if (typeof solutionImage === 'string' && solutionImage !== '') {
		checkHttps(solutionImage, { ...ref, field: 'question.solution_image.url' },
			`Obrázek u řešení v kroku ${position}`, add);
	}

	// §15 accessibility nudge.
	if (step.type === 'image' && step.image !== undefined) {
		const alt = step.image.alt;
		if (typeof alt !== 'string' || alt.trim() === '') {
			add('warning', 'W_IMAGE_NO_ALT', { ...ref, field: 'image.alt' },
				`Obrázek v kroku ${position} nemá popis. Žák, který používá čtečku obrazovky, se nedozví, co je na něm — a stejný text se ukáže, když se obrázek nenačte.`);
		}
	}
}

function checkHttps(url: string, ref: Ref, subject: string, add: Add) {
	if (url.startsWith('https://')) return;
	add('error', 'E_MEDIA_NOT_HTTPS', ref,
		`${subject} není na adrese https:// — ve webové verzi aplikace se žákovi nenačte.`);
}

// ────────────────────────────────── §14.3 vectors ──────────────────────────────────

function checkVectors(doc: CourseV2, block: BlockV2, skillConfig: SkillConfig | null | undefined, add: Add) {
	const gpf = block.gpf;
	if (gpf === undefined) return;
	const expected = dimensionCount(skillConfig);
	const cardName = blockLabel(doc, block);

	for (const name of ['relation_vector', 'elo_vector'] as const) {
		const vector = gpf[name];
		if (vector === undefined) continue;
		const ref: Ref = { blockId: block.block_id, field: `gpf.${name}` };

		if (expected !== null && vector.length !== expected) {
			add('error', 'E_VECTOR_LENGTH', ref,
				`Vektor ${name} v bloku „${cardName}“ má ${vector.length} hodnot, kurz jich používá ${expected}. Výsledek žáka se do jeho profilu dovedností nezapíše.`);
		}
	}

	const relation = gpf.relation_vector;
	if (relation !== undefined) {
		const ref: Ref = { blockId: block.block_id, field: 'gpf.relation_vector' };
		for (const [i, value] of relation.entries()) {
			if (value !== 0 && value !== 1 && value !== 2) {
				add('error', 'E_RELATION_VECTOR_VALUE', ref,
					`Vektor relation_vector v bloku „${cardName}“ má na pozici ${i} hodnotu ${value}; povolené jsou jen 0, 1 a 2. Výsledek žáka se nezapíše.`);
				break;
			}
		}
		const strong = relation.filter((v) => v === 2).length;
		if (strong > 3) {
			add('warning', 'W_TOO_MANY_STRONG_RELATIONS', ref,
				`Blok „${cardName}“ tvrdí silný vztah k ${strong} dovednostem. Jedna odpověď žáka se rozmělní mezi všechny a profil dovedností bude nepřesný.`);
		}
		if (relation.every((v) => v === 0) && gpf.elo_vector !== undefined) {
			add('warning', 'W_RELATION_VECTOR_ALL_ZERO', ref,
				`Blok „${cardName}“ má vyplněnou obtížnost, ale žádnou vazbu na dovednost. Žák jej vyřeší a v jeho profilu se nic nepohne.`);
		}
	}

	const elo = gpf.elo_vector;
	if (elo !== undefined) {
		const ref: Ref = { blockId: block.block_id, field: 'gpf.elo_vector' };
		for (const [i, value] of elo.entries()) {
			if (value < ELO_MIN || value > ELO_MAX) {
				add('error', 'E_ELO_VECTOR_RANGE', ref,
					`Obtížnost v elo_vector bloku „${cardName}“ je na pozici ${i} rovna ${value}; povolený rozsah je ${ELO_MIN}–${ELO_MAX}. Adaptivní výběr úloh pro žáka přestane dávat smysl.`);
				break;
			}
		}
	}
}

function meanElo(doc: CourseV2): number | null {
	let sum = 0;
	let count = 0;
	for (const block of doc.blocks) {
		const relation = block.gpf?.relation_vector;
		const elo = block.gpf?.elo_vector;
		if (elo === undefined) continue;
		for (const [i, value] of elo.entries()) {
			if (relation !== undefined && (relation[i] ?? 0) === 0) continue;
			sum += value;
			count++;
		}
	}
	return count === 0 ? null : sum / count;
}

/** §14 warning 8 — an outlier difficulty with no author estimate to back it up. */
function checkEloOutlier(doc: CourseV2, block: BlockV2, courseMean: number | null, add: Add) {
	if (courseMean === null) return;
	const elo = block.gpf?.elo_vector;
	if (elo === undefined) return;
	if (typeof block.learning?.difficulty === 'number') return;

	const relation = block.gpf?.relation_vector;
	const relevant = elo.filter((_, i) => relation === undefined || (relation[i] ?? 0) > 0);
	if (relevant.length === 0) return;
	const mean = relevant.reduce((a, b) => a + b, 0) / relevant.length;

	if (Math.abs(mean - courseMean) > 2) {
		add('warning', 'W_ELO_OUTLIER', { blockId: block.block_id, field: 'gpf.elo_vector' },
			`Blok „${blockLabel(doc, block)}“ je nastavený jako výrazně ${mean > courseMean ? 'těžší' : 'lehčí'} než zbytek kurzu (${mean.toFixed(1)} proti průměru ${courseMean.toFixed(1)}), ale nemá vyplněnou vlastní obtížnost. Než se obtížnost dopočítá z dat, může se žákovi nabídnout ve špatnou chvíli.`);
	}
}

// ─────────────────────────── §14.4 prerequisites ───────────────────────────

function checkPrerequisiteGraph(doc: CourseV2, index: DocIndex, add: Add) {
	for (const block of doc.blocks) {
		const cardName = blockLabel(doc, block);
		for (const [i, rule] of (block.learning?.prerequisites ?? []).entries()) {
			const ref: Ref = { blockId: block.block_id, field: `learning.prerequisites.${i}` };

			if (typeof rule.block_id === 'string' && rule.block_id !== '' && !index.blocksById.has(rule.block_id)) {
				// The required card is what does not exist — nothing to name it by.
				add('error', 'E_PREREQ_UNRESOLVED', ref,
					`Blok „${cardName}“ vyžaduje zvládnutý blok „${rule.block_id}“, který v kurzu není. Žákovi se blok nikdy neodemkne.`);
			}
			if (rule.min_level >= 0.9) {
				add('warning', 'W_PREREQ_MIN_LEVEL_HIGH', ref,
					`Blok „${cardName}“ se odemkne až při zvládnutí na ${Math.round(rule.min_level * 100)} %. Téměř žádný žák se k němu nedostane.`);
			}
		}
	}

	for (const cycle of findCycles(doc)) {
		// Every id in a cycle is, by construction (`findCycles` only follows edges to
		// blocks that exist), a real card — so unlike the two checks above, there is
		// always a name to give it and no reason to fall back to the id.
		const names = cycle.map((id) => {
			const block = doc.blocks.find((b) => b.block_id === id)!;
			return `„${blockLabel(doc, block)}“`;
		});
		add('error', 'E_PREREQ_CYCLE', { blockId: cycle[0] },
			`Bloky ${names.join(' → ')} na sebe čekají navzájem. Žádný z nich se žákovi neodemkne.`);
	}
}

function findCycles(doc: CourseV2): string[][] {
	const edges = new Map<string, string[]>();
	for (const block of doc.blocks) {
		edges.set(
			block.block_id,
			(block.learning?.prerequisites ?? [])
				.map((r) => r.block_id)
				.filter((id): id is string => typeof id === 'string' && id !== '')
		);
	}

	const cycles: string[][] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];
	const reported = new Set<string>();

	const visit = (id: string) => {
		const current = state.get(id);
		if (current === 'done') return;
		if (current === 'visiting') {
			const start = stack.indexOf(id);
			const cycle = stack.slice(start);
			const key = [...cycle].sort().join('|');
			if (!reported.has(key)) {
				reported.add(key);
				cycles.push([...cycle, id]);
			}
			return;
		}
		state.set(id, 'visiting');
		stack.push(id);
		for (const next of edges.get(id) ?? []) if (edges.has(next)) visit(next);
		stack.pop();
		state.set(id, 'done');
	};

	for (const id of edges.keys()) visit(id);
	return cycles;
}

// ───────────────────────────────── course level ─────────────────────────────────

function checkCourseLevel(doc: CourseV2, index: DocIndex, options: ValidateOptions, add: Add) {
	if (
		options.lastPublishedVersion !== undefined &&
		typeof doc.version === 'number' &&
		doc.version <= options.lastPublishedVersion
	) {
		add('warning', 'W_VERSION_NOT_BUMPED', { field: 'version' },
			`Verze kurzu je stále ${doc.version}, stejně jako u poslední publikace. Žáci, kteří kurz už mají stažený, novou verzi nedostanou.`);
	}

	// §14 warning 12
	if (doc.only_once === true) {
		const practice = doc.blocks.filter((b) =>
			isPracticeBlock(b, bindingPractice(index, b.block_id))
		);
		if (practice.length > 0) {
			add('warning', 'W_ONLY_ONCE_WITH_PRACTICE', { field: 'only_once' },
				`Kurz je nastavený na jediné projití, ale ${practice.length} blok(ů) je zařazeno do cvičení. Žákovi se budou opakovaně nabízet karty z kurzu, který už nemůže otevřít.`);
		}
	}
}

function bindingPractice(index: DocIndex, blockId: string): boolean {
	return (index.referencesToBlock.get(blockId) ?? []).some(
		(reference) => reference.kind === 'binding' && reference.from.lessonId !== undefined &&
			index.lessonsById.get(reference.from.lessonId)?.blocks.some(
				(b) => b.block_id === blockId && b.default_practice === true
			) === true
	);
}
