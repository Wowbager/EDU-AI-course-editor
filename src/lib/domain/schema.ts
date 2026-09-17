/**
 * CourseV2 schema — the authoritative shape is COURSE-AUTHORING-SPEC.md.
 *
 * Two rules govern this file:
 *  - Parsing never injects defaults. A field absent from the source stays absent,
 *    so import → no-op edit → export does not grow the document (§7 golden round-trips).
 *  - Unknown keys are preserved (`looseObject`) so a field the editor does not model
 *    yet survives a round trip. Legacy keys are the exception: they are migrated on
 *    import and never written back (§3 invariant 7) — see `legacy.ts`.
 */
import { z } from 'zod';

export const EXPORT_TYPES = ['course_v2', 'exercise_v2', 'quiz_v2'] as const;
export const STATUSES = ['draft', 'private', 'locked', 'approved', 'published'] as const;
export const BLOCK_TYPES = ['display', 'question', 'exercise'] as const;
export const STEP_TYPES = ['text', 'image', 'video', 'audio', 'question'] as const;
export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'open', 'numeric'] as const;
export const MEDIA_POSITIONS = ['above', 'below', 'inline'] as const;

/** §9 — the `go_to` values that are not document references. */
export const GOTO_KEYWORDS = ['NEXT_STEP', 'AGAIN', 'END', 'CHAT', 'LECTURE'] as const;

export const imageRefSchema = z.looseObject({
	url: z.string(),
	alt: z.string().optional(),
	position: z.enum(MEDIA_POSITIONS).optional()
});

export const videoRefSchema = z.looseObject({
	url: z.string(),
	position: z.enum(MEDIA_POSITIONS).optional()
});

export const audioRefSchema = z.looseObject({ url: z.string() });

export const questionOptionSchema = z.looseObject({
	id: z.string(),
	text: z.string(),
	is_correct: z.boolean().optional(),
	feedback: z.string().optional(),
	feedback_image: imageRefSchema.optional(),
	score_koef: z.number().optional(),
	mark: z.string().optional(),
	go_to: z.string().nullable().optional()
});

export const questionConfigSchema = z.looseObject({
	type: z.enum(QUESTION_TYPES),
	options: z.array(questionOptionSchema).optional(),
	correct_answer: z.string().optional(),
	correct_number: z.number().optional(),
	tolerance: z.number().optional(),
	allow_multiple: z.boolean().optional(),
	show_answers: z.boolean().optional(),
	show_solution: z.boolean().optional(),
	solution: z.string().optional(),
	solution_image: imageRefSchema.optional(),
	allow_photo: z.boolean().optional()
});

export const blockStepSchema = z.looseObject({
	id: z.string(),
	type: z.enum(STEP_TYPES),
	order: z.number().int().optional(),
	content: z.string().optional(),
	image: imageRefSchema.optional(),
	video: videoRefSchema.optional(),
	audio: audioRefSchema.optional(),
	question: questionConfigSchema.optional(),
	hint: z.string().optional(),
	help: z.string().optional(),
	default_practice: z.boolean().optional()
});

export const prerequisiteRuleSchema = z.looseObject({
	block_id: z.string().optional(),
	skill: z.string().optional(),
	min_level: z.number(),
	weight: z.number().optional()
});

export const gpfSchema = z.looseObject({
	domain: z.string().optional(),
	construct: z.string().optional(),
	subconstruct: z.string().optional(),
	grade: z.number().int().nullable().optional(),
	level: z.number().int().optional(),
	vector: z.array(z.number()).optional(),
	kb_vector: z.array(z.number()).optional(),
	relation_vector: z.array(z.number()).optional(),
	elo_vector: z.array(z.number()).optional()
});

export const learningSchema = z.looseObject({
	concepts: z.array(z.string()).optional(),
	competencies: z.record(z.string(), z.number()).optional(),
	bloom_level: z.number().int().optional(),
	difficulty: z.number().int().optional(),
	prerequisites: z.array(prerequisiteRuleSchema).optional(),
	d_data: z.record(z.string(), z.unknown()).optional(),
	l_data: z.record(z.string(), z.unknown()).optional()
});

export const fsrsSchema = z.looseObject({
	initial_difficulty: z.number().optional(),
	initial_stability: z.number().optional(),
	initial_recall: z.number().optional(),
	forgetting_rate: z.number().optional(),
	repetitions: z.number().int().optional(),
	weight: z.number().optional(),
	min_interval: z.number().optional(),
	max_interval: z.number().optional(),
	skip_condition: z.string().optional(),
	time_limit_sec: z.number().optional()
});

export const adaptationSchema = z.looseObject({
	scaffolded: z.string().optional(),
	full: z.string().optional()
});

export const blockSchema = z.looseObject({
	export_type: z.literal('block_v2').optional(),
	block_id: z.string(),
	type: z.enum(BLOCK_TYPES),
	status: z.enum(STATUSES).optional(),
	version: z.number().int().optional(),
	language: z.string().optional(),
	author: z.string().optional(),
	updated: z.string().optional(),
	duration: z.string().optional(),
	xp: z.number().int().optional(),
	default_practice: z.boolean().optional(),
	hint: z.string().optional(),
	help: z.string().optional(),
	gpf: gpfSchema.optional(),
	learning: learningSchema.optional(),
	fsrs: fsrsSchema.optional(),
	adaptation: adaptationSchema.optional(),
	steps: z.array(blockStepSchema)
});

export const bindingSchema = z.looseObject({
	block_id: z.string(),
	order: z.number().int().optional(),
	bg_color: z.string().optional(),
	bg_image: z.string().optional(),
	default_practice: z.boolean().optional()
});

export const lessonSchema = z.looseObject({
	lesson_id: z.string(),
	name: z.string().optional(),
	description: z.string().optional(),
	order: z.number().int().optional(),
	version: z.number().int().optional(),
	header_image: imageRefSchema.optional(),
	ai_context: z.string().optional(),
	blocks: z.array(bindingSchema)
});

export const courseSchema = z.looseObject({
	export_type: z.enum(EXPORT_TYPES),
	course_id: z.string(),
	version: z.number().int().optional(),
	name: z.string().optional(),
	description: z.string().optional(),
	language: z.string().optional(),
	author: z.string().optional(),
	updated: z.string().optional(),
	status: z.enum(STATUSES).optional(),
	emoji: z.string().optional(),
	estimated_minutes: z.number().int().optional(),
	header_image: imageRefSchema.optional(),
	pin: z.string().optional(),
	logged_only: z.boolean().optional(),
	only_once: z.boolean().optional(),
	only_quiz: z.boolean().optional(),
	starts_with_quiz: z.boolean().optional(),
	quiz_evaluate: z.boolean().optional(),
	max_xp: z.number().int().optional(),
	stop_gambling: z.boolean().optional(),
	stop_notice: z.string().optional(),
	ai_context: z.string().optional(),
	lessons: z.array(lessonSchema),
	blocks: z.array(blockSchema)
});

export type ImageRef = z.infer<typeof imageRefSchema>;
export type VideoRef = z.infer<typeof videoRefSchema>;
export type AudioRef = z.infer<typeof audioRefSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type QuestionConfig = z.infer<typeof questionConfigSchema>;
export type BlockStep = z.infer<typeof blockStepSchema>;
export type PrerequisiteRule = z.infer<typeof prerequisiteRuleSchema>;
export type Gpf = z.infer<typeof gpfSchema>;
export type Learning = z.infer<typeof learningSchema>;
export type Fsrs = z.infer<typeof fsrsSchema>;
export type Adaptation = z.infer<typeof adaptationSchema>;
export type BlockV2 = z.infer<typeof blockSchema>;
export type LessonBlockBinding = z.infer<typeof bindingSchema>;
export type LessonV2 = z.infer<typeof lessonSchema>;
export type CourseV2 = z.infer<typeof courseSchema>;

export type ExportType = (typeof EXPORT_TYPES)[number];
export type BlockType = (typeof BLOCK_TYPES)[number];
export type StepType = (typeof STEP_TYPES)[number];
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type Status = (typeof STATUSES)[number];

/**
 * Canonical key order per node, used by `serialise`. Keys not listed are kept and
 * emitted after the known ones, in their original order, so an unmodelled field
 * survives the round trip.
 */
export const KEY_ORDER = {
	course: [
		'export_type', 'course_id', 'version', 'name', 'description', 'language', 'author',
		'updated', 'status', 'emoji', 'estimated_minutes', 'pin', 'logged_only', 'only_once',
		'only_quiz', 'starts_with_quiz', 'quiz_evaluate', 'max_xp', 'stop_gambling',
		'stop_notice', 'ai_context', 'header_image', 'lessons', 'blocks'
	],
	lesson: [
		'lesson_id', 'version', 'name', 'description', 'order', 'header_image', 'ai_context',
		'blocks'
	],
	binding: ['block_id', 'order', 'bg_color', 'bg_image', 'default_practice'],
	block: [
		'export_type', 'block_id', 'version', 'language', 'author', 'updated', 'status', 'type',
		'duration', 'xp', 'default_practice', 'hint', 'help', 'gpf', 'learning', 'fsrs',
		'adaptation', 'steps'
	],
	gpf: [
		'domain', 'construct', 'subconstruct', 'grade', 'level', 'vector', 'kb_vector',
		'relation_vector', 'elo_vector'
	],
	learning: [
		'concepts', 'competencies', 'bloom_level', 'difficulty', 'prerequisites', 'd_data', 'l_data'
	],
	prerequisite: ['block_id', 'skill', 'min_level', 'weight'],
	fsrs: [
		'initial_difficulty', 'initial_stability', 'initial_recall', 'forgetting_rate',
		'repetitions', 'weight', 'min_interval', 'max_interval', 'skip_condition', 'time_limit_sec'
	],
	adaptation: ['scaffolded', 'full'],
	step: [
		'id', 'type', 'order', 'content', 'image', 'video', 'audio', 'hint', 'help',
		'default_practice', 'question'
	],
	question: [
		'type', 'show_answers', 'show_solution', 'allow_multiple', 'allow_photo',
		'correct_answer', 'correct_number', 'tolerance', 'solution', 'solution_image', 'options'
	],
	option: [
		'id', 'text', 'is_correct', 'score_koef', 'mark', 'feedback', 'feedback_image', 'go_to'
	],
	image: ['url', 'alt', 'position'],
	video: ['url', 'position'],
	audio: ['url']
} as const;
