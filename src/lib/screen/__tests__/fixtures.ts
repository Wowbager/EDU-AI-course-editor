import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCourse, parseCourse } from '$lib/domain/document';
import type { CourseV2 } from '$lib/domain/schema';
import { DocStore } from '$lib/state/doc-store.svelte';
import { MODES, type Mode } from '$lib/ui/fields';

const dir = fileURLToPath(new URL('../../domain/__tests__/fixtures', import.meta.url));

/** Every fixture of the domain tests: the corpus and the two spec §16 courses. */
export const FIXTURES: string[] = [
	...readdirSync(`${dir}/corpus`).map((f) => `corpus/${f}`),
	'spec-16-course.json',
	'spec-16-course-broken.json'
];

export const fixtureDoc = (name: string): CourseV2 => {
	const raw = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
	return name.startsWith('corpus/') ? importCourse(raw).doc : parseCourse(raw);
};

/** A store holding a fixture the way the page loads an import: split into one block per question. */
export function storeFor(name: string, mode: Mode = 'teacher'): DocStore {
	const store = new DocStore();
	store.load(fixtureDoc(name));
	store.splitQuestions();
	store.mode = mode;
	return store;
}

export { MODES };
