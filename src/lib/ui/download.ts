import type { CourseV2 } from '$lib/domain/schema';
import { serialiseToJson } from '$lib/domain/document';

/** Hand a course to the browser as a file. Returns the exact text written. */
export function downloadCourse(doc: CourseV2, filename: string): string {
	const json = serialiseToJson(doc);
	const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
	return json;
}
