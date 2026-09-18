import { z } from 'zod';
import { courseSchema } from '$lib/domain/schema';

export const DRAFT_KEY = 'edu-editor:draft:v1';
export const draftSchema = z.object({
	format: z.literal(1),
	savedAt: z.string(),
	doc: courseSchema,
	mode: z.enum(['teacher', 'metodik', 'advanced']),
	selection: z.object({
		lessonId: z.string().optional(), blockId: z.string().optional(),
		stepId: z.string().optional(), optionId: z.string().optional(), field: z.string().optional()
	}).nullable(),
	reserved: z.object({ blocks: z.array(z.string()), lessons: z.array(z.string()), steps: z.array(z.string()) })
});
export type Draft = z.infer<typeof draftSchema>;

/** Recovery checks shape, not publish validation: unfinished cards must survive. */
export function readDraft(text: string): Draft {
	return draftSchema.parse(JSON.parse(text));
}
