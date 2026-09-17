/**
 * Import normalisation. Everything the editor can read but must never write back
 * (§3 invariant 7) is converted here, once, on the way in.
 *
 * Handles: course_v2 / exercise_v2 / quiz_v2, a single block_v2 file, legacy flat
 * blocks (`content` / `image` / `video` / `question` with no steps), steps as a
 * `{s1: …}` map, legacy step and block type names, legacy `evaluation_config`,
 * `lesson.block_ids`, and V1 `course` / `lecture` exports.
 *
 * Nothing is dropped silently: anything V2 cannot express is reported in
 * `ImportReport.notes` so the author is told what needs re-authoring.
 */
import type { Ref } from './ref';

export interface ImportNote {
	code: string;
	message: string;
	ref?: Ref;
}

export interface ImportReport {
	/** What the source document was recognised as. */
	sourceKind:
		| 'course_v2'
		| 'exercise_v2'
		| 'quiz_v2'
		| 'block_v2'
		| 'v1_course'
		| 'v1_lecture'
		| 'unknown';
	notes: ImportNote[];
}

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Block-level keys that are a legacy shape: migrated to steps, never written back. */
const LEGACY_BLOCK_KEYS = [
	'content', 'image', 'video', 'audio', 'question', 'duration_minutes',
	'gpf_domain', 'gpf_construct', 'gpf_subconstruct', 'gpf_grade', 'gpf_level',
	'type_description', 'duration_description', 'gpf_grade_description'
];
const LEGACY_LESSON_KEYS = ['block_ids'];
const LEGACY_STEP_KEYS = [
	'step_id', 'text', 'text2', 'text3', 'modes', 'expected_output_format', 'evaluation_config',
	'url', 'image_url', 'video_url', 'audio_url', 'alt', 'mode', 'user_options', 'next_actions',
	'position', 'answers', 'substeps', 'uuid4', 'step_type', 'response_type', 'free_input'
];

const BLOCK_TYPE_ALIASES: Record<string, string> = {
	display: 'display', question: 'question', exercise: 'exercise',
	motivation: 'display', content: 'display', learning: 'display', org: 'display',
	quiz: 'question'
};

const STEP_TYPE_ALIASES: Record<string, string> = {
	text: 'text', image: 'image', video: 'video', audio: 'audio', question: 'question',
	display: 'text', evaluation: 'question', hint: 'text',
	display_solution: 'text', display_task: 'text'
};

const QUESTION_TYPE_ALIASES: Record<string, string> = {
	multiple_choice: 'multiple_choice', true_false: 'true_false', open: 'open', numeric: 'numeric',
	single_select: 'multiple_choice', multi_select: 'multiple_choice',
	free_text: 'open', text: 'open', number: 'numeric', matching: 'multiple_choice'
};

/**
 * Real documents carry explicit `null`s where a value is simply absent. The app
 * reads them as absent, so the editor does too — a null is dropped on import rather
 * than carried around as a third state. `gpf.grade` keeps its null: there the spec
 * gives it a meaning ("no target year"), and free-form analytics bags are left alone.
 */
function stripNulls(node: unknown, path: string[] = []): unknown {
	if (Array.isArray(node)) return node.map((v) => stripNulls(v, path));
	if (!isObj(node)) return node;

	const last = path[path.length - 1];
	if (last === 'd_data' || last === 'l_data') return node;

	const out: Json = {};
	for (const [key, value] of Object.entries(node)) {
		if (value === null && !(key === 'grade' && last === 'gpf')) continue;
		out[key] = stripNulls(value, [...path, key]);
	}
	return out;
}

export function normaliseDocument(raw: unknown): { doc: Json; report: ImportReport } {
	const notes: ImportNote[] = [];
	if (!isObj(raw)) {
		return {
			doc: emptyCourse(),
			report: { sourceKind: 'unknown', notes: [note('IMPORT_NOT_AN_OBJECT', 'Soubor neobsahuje JSON objekt.')] }
		};
	}

	// A null is the absence of a value, so it is dropped before anything else looks
	// at the document (see `stripNulls`).
	const doc = stripNulls(raw) as Json;
	const exportType = str(doc.export_type);

	if (exportType === 'course' || Array.isArray(doc.lectures)) {
		return { doc: normaliseV1Course(doc, notes), report: { sourceKind: 'v1_course', notes } };
	}
	if (
		exportType === 'lecture' ||
		(doc.lectures === undefined && Array.isArray(doc.steps) && doc.block_id === undefined)
	) {
		return {
			doc: normaliseV1Course({ ...doc, lectures: [doc] }, notes),
			report: { sourceKind: 'v1_lecture', notes }
		};
	}
	if (exportType === 'block_v2' || (doc.block_id !== undefined && doc.lessons === undefined)) {
		return { doc: wrapSingleBlock(doc, notes), report: { sourceKind: 'block_v2', notes } };
	}

	const kind =
		exportType === 'exercise_v2' || exportType === 'quiz_v2' || exportType === 'course_v2'
			? (exportType as ImportReport['sourceKind'])
			: 'unknown';
	if (kind === 'unknown') {
		notes.push(
			note('IMPORT_UNKNOWN_EXPORT_TYPE', `Neznámý export_type „${exportType ?? '—'}“ — soubor je načten jako course_v2.`)
		);
	}
	return {
		doc: normaliseCourse(doc, notes, kind === 'unknown' ? 'course_v2' : exportType!),
		report: { sourceKind: kind, notes }
	};
}

const note = (code: string, message: string, ref?: Ref): ImportNote => ({ code, message, ref });

function emptyCourse(): Json {
	return { export_type: 'course_v2', course_id: '', version: 1, lessons: [], blocks: [] };
}

// ─────────────────────────────── course_v2 family ───────────────────────────────

function normaliseCourse(raw: Json, notes: ImportNote[], exportType: string): Json {
	const out: Json = { ...raw, export_type: exportType };

	const blocks: Json[] = Array.isArray(raw.blocks) ? raw.blocks.filter(isObj).map((b) => ({ ...b })) : [];
	const byId = new Map<string, Json>();
	for (const b of blocks) {
		const id = str(b.block_id);
		if (id !== undefined) byId.set(id, b);
	}

	const lessons: Json[] = [];
	for (const rawLesson of Array.isArray(raw.lessons) ? raw.lessons : []) {
		if (!isObj(rawLesson)) continue;
		lessons.push(normaliseLesson(rawLesson, notes, blocks, byId));
	}

	out.lessons = lessons;
	out.blocks = blocks.map((b) => normaliseBlock(b, notes));
	return out;
}

function normaliseLesson(raw: Json, notes: ImportNote[], blocks: Json[], byId: Map<string, Json>): Json {
	const out: Json = { ...raw };
	const lessonId = str(raw.lesson_id) ?? '';

	let bindings: Json[] = [];
	if (Array.isArray(raw.blocks)) {
		bindings = raw.blocks.filter(isObj).map((entry, i) => {
			// A binding entry that carries a whole block definition: hoist the block,
			// keep only the binding behind.
			if (entry.steps !== undefined || entry.type !== undefined) {
				const blockId = str(entry.block_id) ?? `${lessonId}_B${i + 1}`;
				if (!byId.has(blockId)) {
					const hoisted: Json = { ...entry, block_id: blockId };
					delete hoisted.bg_color;
					delete hoisted.bg_image;
					delete hoisted.order;
					blocks.push(hoisted);
					byId.set(blockId, hoisted);
					notes.push(
						note('IMPORT_HOISTED_BLOCK', `Blok „${blockId}“ byl vložen přímo v lekci — přesunut do společného seznamu bloků.`, {
							lessonId, blockId
						})
					);
				}
				const binding: Json = { block_id: blockId, order: entry.order ?? i + 1 };
				if (entry.bg_color !== undefined) binding.bg_color = entry.bg_color;
				if (entry.bg_image !== undefined) binding.bg_image = entry.bg_image;
				if (entry.default_practice !== undefined) binding.default_practice = entry.default_practice;
				return binding;
			}
			return { ...entry, order: entry.order ?? i + 1 };
		});
	} else if (Array.isArray(raw.block_ids)) {
		// Legacy: lesson.block_ids: ["B1", "B2"]
		bindings = raw.block_ids
			.filter((id): id is string => typeof id === 'string')
			.map((id, i) => ({ block_id: id, order: i + 1 }));
		notes.push(
			note('IMPORT_BLOCK_IDS', `Lekce „${lessonId}“ používala starší zápis block_ids — převeden na seznam bloků.`, { lessonId })
		);
	}

	out.blocks = bindings;
	for (const key of LEGACY_LESSON_KEYS) delete out[key];
	return out;
}

function normaliseBlock(raw: Json, notes: ImportNote[]): Json {
	const out: Json = { ...raw };
	const blockId = str(raw.block_id) ?? '';

	out.export_type = 'block_v2';

	const rawType = str(raw.type) ?? 'display';
	const mapped = BLOCK_TYPE_ALIASES[rawType];
	if (mapped === undefined) {
		out.type = 'display';
		notes.push(note('IMPORT_UNKNOWN_BLOCK_TYPE', `Blok „${blockId}“ měl neznámý typ „${rawType}“ — načten jako výkladový.`, { blockId }));
	} else {
		if (mapped !== rawType) {
			notes.push(note('IMPORT_BLOCK_TYPE_ALIAS', `Blok „${blockId}“: typ „${rawType}“ převeden na „${mapped}“.`, { blockId }));
		}
		out.type = mapped;
	}

	// duration: accept int minutes and `duration_minutes`
	if (typeof raw.duration === 'number') out.duration = `${raw.duration} min`;
	else if (raw.duration === undefined && typeof raw.duration_minutes === 'number') {
		out.duration = `${raw.duration_minutes} min`;
	}

	// Flattened gpf_* keys (PedF block definition shape).
	const flatGpf: Json = {};
	for (const [key, target] of [
		['gpf_domain', 'domain'], ['gpf_construct', 'construct'], ['gpf_subconstruct', 'subconstruct'],
		['gpf_grade', 'grade'], ['gpf_level', 'level']
	] as const) {
		if (raw[key] !== undefined) flatGpf[target] = raw[key];
	}
	if (Object.keys(flatGpf).length > 0) {
		out.gpf = { ...flatGpf, ...(isObj(raw.gpf) ? raw.gpf : {}) };
		notes.push(note('IMPORT_FLAT_GPF', `Blok „${blockId}“: GPF údaje byly rozsypané v samostatných polích — sloučeny.`, { blockId }));
	}

	// `competencies: []` is how older documents write "none"; the format wants a map.
	if (isObj(raw.learning) && Array.isArray((raw.learning as Json).competencies)) {
		const list = (raw.learning as Json).competencies as unknown[];
		const learning: Json = { ...(raw.learning as Json) };
		delete learning.competencies;
		out.learning = learning;
		if (list.length > 0) {
			notes.push(
				note('IMPORT_COMPETENCIES_SHAPE', `Blok „${blockId}“ měl výstupy RVP zapsané seznamem bez vah — doplň je prosím znovu, jinak se blok nezapočítá do pokrytí učiva.`, { blockId })
			);
		}
	}

	// steps: map form, list form, or a legacy flat block with no steps at all.
	let steps: Json[];
	if (isObj(raw.steps)) {
		const keys = Object.keys(raw.steps).sort(byStepKey);
		steps = keys.map((key) => ({ ...(isObj((raw.steps as Json)[key]) ? ((raw.steps as Json)[key] as Json) : {}), id: key }));
		notes.push(note('IMPORT_STEPS_MAP', `Blok „${blockId}“ měl kroky zapsané jako objekt — převedeny na seznam.`, { blockId }));
	} else if (Array.isArray(raw.steps)) {
		steps = raw.steps.filter(isObj).map((s) => ({ ...s }));
	} else {
		steps = flatBlockToSteps(raw, notes, blockId);
	}

	out.steps = steps.map((step, i) => normaliseStep(step, i, blockId, notes));
	for (const key of LEGACY_BLOCK_KEYS) delete out[key];
	return out;
}

/** Sorts `s1, s2, s10` numerically; falls back to lexicographic for other keys. */
function byStepKey(a: string, b: string): number {
	const na = /^s(\d+)$/.exec(a);
	const nb = /^s(\d+)$/.exec(b);
	if (na && nb) return Number(na[1]) - Number(nb[1]);
	return a.localeCompare(b);
}

/** Legacy flat block: `content` / `image` / `video` / `question` directly on the block. */
function flatBlockToSteps(raw: Json, notes: ImportNote[], blockId: string): Json[] {
	const steps: Json[] = [];
	if (typeof raw.content === 'string' && raw.content.trim() !== '') {
		steps.push({ id: `s${steps.length + 1}`, type: 'text', content: raw.content });
	}
	if (isObj(raw.image)) steps.push({ id: `s${steps.length + 1}`, type: 'image', image: { ...raw.image } });
	if (isObj(raw.video)) steps.push({ id: `s${steps.length + 1}`, type: 'video', video: { ...raw.video } });
	if (isObj(raw.audio)) steps.push({ id: `s${steps.length + 1}`, type: 'audio', audio: { ...raw.audio } });
	if (isObj(raw.question)) steps.push({ id: `s${steps.length + 1}`, type: 'question', question: { ...raw.question } });

	if (steps.length > 0) {
		notes.push(
			note('IMPORT_FLAT_BLOCK', `Blok „${blockId}“ byl ve starém plochém formátu — obsah převeden na ${steps.length} krok(ů).`, { blockId })
		);
	}
	return steps;
}

function normaliseStep(raw: Json, index: number, blockId: string, notes: ImportNote[]): Json {
	const out: Json = { ...raw };
	const id = str(raw.id) ?? str(raw.step_id) ?? `s${index + 1}`;
	out.id = id;
	const ref: Ref = { blockId, stepId: id };

	const rawType = str(raw.type) ?? (raw.question !== undefined || raw.evaluation_config !== undefined ? 'question' : 'text');
	out.type = STEP_TYPE_ALIASES[rawType] ?? 'text';
	if (STEP_TYPE_ALIASES[rawType] === undefined) {
		notes.push(note('IMPORT_UNKNOWN_STEP_TYPE', `Krok „${id}“ měl neznámý typ „${rawType}“ — načten jako text.`, ref));
	}

	if (typeof raw.order !== 'number') out.order = index + 1;

	// content: `text`, or the legacy modes.static.output
	if (typeof out.content !== 'string') {
		const modes = isObj(raw.modes) ? raw.modes : undefined;
		const staticMode = modes && isObj(modes.static) ? (modes.static as Json) : undefined;
		const legacyText = str(raw.text) ?? (staticMode ? str(staticMode.output) : undefined);
		if (legacyText !== undefined) {
			out.content = legacyText;
			notes.push(note('IMPORT_STEP_TEXT', `Krok „${id}“: text byl ve starém poli — převeden na obsah kroku.`, ref));
		}
		const staticImage = staticMode ? str(staticMode.image_url) : undefined;
		if (staticImage !== undefined && out.image === undefined) {
			out.image = { url: staticImage };
		}
	}

	const position = str(raw.position);

	// Media given as a bare URL on the step rather than as an object.
	if (out.type === 'image' && !isObj(out.image)) {
		const url = str(raw.url) ?? str(raw.image_url);
		if (url !== undefined) out.image = { url, ...(str(raw.alt) !== undefined ? { alt: str(raw.alt) } : {}) };
	}
	if (out.type === 'video' && !isObj(out.video)) {
		const url = str(raw.url) ?? str(raw.video_url);
		if (url !== undefined) out.video = { url };
	}
	if (out.type === 'audio' && !isObj(out.audio)) {
		const url = str(raw.url) ?? str(raw.audio_url);
		if (url !== undefined) out.audio = { url };
	}
	// `position` belongs on the media object in V2.
	if (position !== undefined) {
		if (isObj(out.image) && out.image.position === undefined) out.image = { ...out.image, position };
		else if (isObj(out.video) && out.video.position === undefined) out.video = { ...out.video, position };
	}

	// question: `evaluation_config` is the legacy spelling.
	const questionSource = isObj(raw.question) ? raw.question : isObj(raw.evaluation_config) ? raw.evaluation_config : undefined;
	if (questionSource !== undefined) {
		out.question = normaliseQuestion(questionSource, raw, ref, notes);
		if (isObj(raw.evaluation_config)) {
			notes.push(note('IMPORT_EVALUATION_CONFIG', `Krok „${id}“: otázka byla v poli evaluation_config — převedena.`, ref));
		}
	}

	if (Array.isArray(raw.user_options) && raw.user_options.length > 0) {
		notes.push(
			note('IMPORT_USER_OPTIONS_DROPPED', `Krok „${id}“ měl vlastní navigační tlačítka (user_options), která formát V2 nezná — zkontroluj, zda je nahradit odpověďmi.`, ref)
		);
	}

	for (const key of LEGACY_STEP_KEYS) delete out[key];
	return out;
}

function normaliseQuestion(raw: Json, step: Json, ref: Ref, notes: ImportNote[]): Json {
	const out: Json = { ...raw };

	const rawType = str(raw.type) ?? 'multiple_choice';
	const mapped = QUESTION_TYPE_ALIASES[rawType] ?? 'multiple_choice';
	out.type = mapped;
	if (rawType === 'multi_select') out.allow_multiple = true;
	if (rawType === 'matching') {
		notes.push(
			note('IMPORT_MATCHING_UNSUPPORTED', `Krok „${ref.stepId}“ byl typu „přiřazování“, který V2 nezná — načten jako výběr z možností a je potřeba jej přepsat.`, ref)
		);
	}
	if (QUESTION_TYPE_ALIASES[rawType] === undefined) {
		notes.push(note('IMPORT_UNKNOWN_QUESTION_TYPE', `Krok „${ref.stepId}“: neznámý typ otázky „${rawType}“ — načten jako výběr z možností.`, ref));
	}

	const correctIds = Array.isArray(raw.correct_option_ids)
		? new Set(raw.correct_option_ids.filter((v): v is string => typeof v === 'string'))
		: undefined;

	if (Array.isArray(raw.options)) {
		out.options = raw.options.filter(isObj).map((opt, i) => {
			const option: Json = { ...opt };
			if (str(option.id) === undefined || option.id === '') option.id = String.fromCharCode(97 + i);
			if (correctIds?.has(String(option.id))) option.is_correct = true;
			if (option.mark !== undefined && typeof option.mark !== 'string') option.mark = String(option.mark);
			if (typeof option.image_url === 'string' && option.feedback_image === undefined) {
				option.feedback_image = { url: option.image_url };
			}
			delete option.image_url;
			delete option.description;
			return option;
		});
	}
	delete out.correct_option_ids;
	delete out.question;

	// `next_actions` branched on correctness rather than per option (§9 moved it onto options).
	const nextActions = normaliseNextActions(step.next_actions);
	if (nextActions && Array.isArray(out.options)) {
		out.options = (out.options as Json[]).map((option) => {
			if (option.go_to !== undefined) return option;
			const target = option.is_correct === true ? nextActions.correct : nextActions.incorrect;
			return target === undefined ? option : { ...option, go_to: target };
		});
		notes.push(
			note('IMPORT_NEXT_ACTIONS', `Krok „${ref.stepId}“: větvení bylo zapsané v next_actions — přeneseno na jednotlivé odpovědi.`, ref)
		);
	}

	return out;
}

function normaliseNextActions(raw: unknown): { correct?: string; incorrect?: string } | undefined {
	if (Array.isArray(raw)) {
		const out: { correct?: string; incorrect?: string } = {};
		for (const entry of raw) {
			if (!isObj(entry)) continue;
			const result = isObj(entry.result) ? entry.result : undefined;
			const target = str(entry.go_to);
			if (target === undefined) continue;
			if (result?.is_correct === true) out.correct = target;
			else if (result?.is_correct === false) out.incorrect = target;
		}
		return out.correct === undefined && out.incorrect === undefined ? undefined : out;
	}
	if (isObj(raw)) {
		const out: { correct?: string; incorrect?: string } = {};
		if (str(raw.correct) !== undefined) out.correct = str(raw.correct);
		if (str(raw.incorrect) !== undefined) out.incorrect = str(raw.incorrect);
		return out.correct === undefined && out.incorrect === undefined ? undefined : out;
	}
	return undefined;
}

// ───────────────────────────────── single block ─────────────────────────────────

function wrapSingleBlock(raw: Json, notes: ImportNote[]): Json {
	const block = normaliseBlock({ ...raw }, notes);
	const blockId = str(block.block_id) ?? 'B1';
	notes.push(note('IMPORT_SINGLE_BLOCK', `Soubor obsahoval jeden blok — byl vložen do nového kurzu s jednou lekcí.`, { blockId }));
	return {
		export_type: 'course_v2',
		course_id: blockId,
		version: 1,
		name: str(raw.name) ?? blockId,
		language: str(raw.language) ?? 'cs',
		author: str(raw.author),
		status: 'draft',
		lessons: [{ lesson_id: 'L1', name: str(raw.name) ?? 'Lekce 1', order: 1, blocks: [{ block_id: blockId, order: 1 }] }],
		blocks: [block]
	};
}

// ─────────────────────────────────── V1 import ───────────────────────────────────

/**
 * V1: a course of `lectures`, each a linear list of steps whose answers branch to
 * other lectures. One lecture becomes one lesson holding one block, so a
 * `following_action: "lecture"` becomes a cross-block `go_to` (§9).
 */
function normaliseV1Course(raw: Json, notes: ImportNote[]): Json {
	const lectures = (Array.isArray(raw.lectures) ? raw.lectures : []).filter(isObj);
	const blockIdByLecture = new Map<string, string>();

	lectures.forEach((lecture, i) => {
		const uuid = str(lecture.uuid4);
		if (uuid !== undefined) blockIdByLecture.set(uuid, `L${i + 1}_B1`);
	});

	const lessons: Json[] = [];
	const blocks: Json[] = [];

	lectures.forEach((lecture, i) => {
		const lessonId = `L${i + 1}`;
		const blockId = `${lessonId}_B1`;
		const v1Steps = (Array.isArray(lecture.steps) ? lecture.steps : [])
			.filter(isObj)
			.slice()
			.sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));

		const stepIdByUuid = new Map<string, string>();
		v1Steps.forEach((s, j) => {
			const uuid = str(s.uuid4);
			if (uuid !== undefined) stepIdByUuid.set(uuid, `s${j + 1}`);
		});

		const steps = v1Steps.map((s, j) => v1Step(s, j, blockId, stepIdByUuid, blockIdByLecture, notes));
		const hasQuestion = steps.some((s) => s.type === 'question');

		blocks.push({
			export_type: 'block_v2',
			block_id: blockId,
			version: 1,
			status: 'draft',
			type: hasQuestion ? 'question' : 'display',
			steps
		});
		lessons.push({
			lesson_id: lessonId,
			version: 1,
			name: str(lecture.name) ?? `Lekce ${i + 1}`,
			description: str(lecture.description),
			order: i + 1,
			blocks: [{ block_id: blockId, order: 1 }]
		});
	});

	notes.push(
		note('IMPORT_V1', `Kurz byl ve formátu V1: ${lectures.length} přednášek převedeno na lekce, každá s jedním blokem. Zkontroluj rozdělení na bloky — blok je jednotka opakování i XP.`)
	);

	return {
		export_type: 'course_v2',
		course_id: str(raw.course_id) ?? slug(str(raw.name) ?? 'IMPORTED'),
		version: 1,
		name: str(raw.name) ?? 'Importovaný kurz',
		description: str(raw.description),
		language: 'cs',
		status: 'draft',
		lessons,
		blocks
	};
}

function v1Step(
	raw: Json,
	index: number,
	blockId: string,
	stepIdByUuid: Map<string, string>,
	blockIdByLecture: Map<string, string>,
	notes: ImportNote[]
): Json {
	const id = `s${index + 1}`;
	const ref: Ref = { blockId, stepId: id };
	const responseType = str(raw.response_type);
	const stepType = str(raw.step_type);
	const text = str(raw.text) ?? '';

	const answers = (Array.isArray(raw.answers) ? raw.answers : []).filter(isObj);
	const isQuestion = responseType === 'question' && answers.length > 0;

	if (stepType === 'image' && str(raw.text2) !== undefined) {
		notes.push(
			note('IMPORT_V1_INLINE_IMAGE', `Krok „${id}“ měl obrázek vložený přímo v datech (base64). Nahraj jej prosím znovu přes správce médií — jinak se studentovi nezobrazí.`, ref)
		);
	}

	const step: Json = { id, type: isQuestion ? 'question' : stepType === 'image' ? 'image' : 'text', order: index + 1 };

	if (stepType === 'image') {
		const url = str(raw.text2);
		if (url !== undefined) step.image = { url, alt: str(raw.description) ?? '' };
		if (text !== '') step.content = text;
	} else {
		step.content = text;
	}

	if (isQuestion) {
		let dropped = 0;
		const options = answers.map((answer, i) => {
			const option: Json = {
				id: String.fromCharCode(97 + i),
				text: str(answer.text2match) ?? str(answer.text) ?? '',
				is_correct: answer.correct_answer === true
			};
			const goTo = v1GoTo(answer, stepIdByUuid, blockIdByLecture, ref, notes);
			if (goTo !== undefined) option.go_to = goTo;
			if (Array.isArray(answer.subanswers) && answer.subanswers.length > 0) dropped += answer.subanswers.length;
			return option;
		});
		if (dropped > 0) {
			notes.push(
				note('IMPORT_V1_SUBANSWERS_DROPPED', `Krok „${id}“ měl ${dropped} vnořených podotázek, které V2 nezná — doplň je prosím jako samostatné kroky, jinak o ně student přijde.`, ref)
			);
		}
		step.question = {
			type: raw.free_input === true ? 'open' : 'multiple_choice',
			show_answers: true,
			show_solution: true,
			options
		};
		if (raw.free_input === true) {
			const correct = options.find((o) => o.is_correct === true);
			if (correct !== undefined) (step.question as Json).correct_answer = correct.text;
		}
	}

	if (str(raw.text3) !== undefined && str(raw.text3) !== '') step.hint = str(raw.text3);
	return step;
}

function v1GoTo(
	answer: Json,
	stepIdByUuid: Map<string, string>,
	blockIdByLecture: Map<string, string>,
	ref: Ref,
	notes: ImportNote[]
): string | undefined {
	const action = str(answer.following_action);
	const target = str(answer.following_action_id);
	switch (action) {
		case 'again':
			return 'AGAIN';
		case 'step':
			return target !== undefined ? stepIdByUuid.get(target) : undefined;
		case 'lecture':
			return target !== undefined ? blockIdByLecture.get(target) : undefined;
		case 'course':
			notes.push(
				note('IMPORT_V1_CROSS_COURSE', `Odpověď v kroku „${ref.stepId}“ vedla do jiného kurzu. V2 skok mezi kurzy nepodporuje — odpověď teď pokračuje dál a je potřeba ji přesměrovat.`, ref)
			);
			return undefined;
		case 'code':
			notes.push(
				note('IMPORT_V1_CODE_ACTION', `Odpověď v kroku „${ref.stepId}“ spouštěla vlastní kód, který V2 nezná — chování je potřeba nahradit větvením.`, ref)
			);
			return undefined;
		default:
			return undefined;
	}
}

const slug = (s: string) =>
	s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase() || 'IMPORTED';
