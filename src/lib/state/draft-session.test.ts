import { describe, expect, it } from 'vitest';
import { DocStore } from './doc-store.svelte';
import { DraftSession } from './draft-session.svelte';
import { DRAFT_KEY, type Draft } from './draft';
import { OPEN_KEY, draftKeyFor, readMeta, type CourseStorage } from './courses';
import type { ArchivedDraft } from './draft-archive';
import { emptyCourse } from '$lib/domain/document';

/** A Map-backed storage with a character quota, like the browser's. */
class FakeStorage implements CourseStorage {
	map = new Map<string, string>();
	limit = Number.POSITIVE_INFINITY;

	get length(): number {
		return this.map.size;
	}
	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null;
	}
	getItem(key: string): string | null {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		let size = key.length + value.length;
		for (const [k, v] of this.map) if (k !== key) size += k.length + v.length;
		if (size > this.limit) throw new DOMException('full', 'QuotaExceededError');
		this.map.set(key, value);
	}
	removeItem(key: string): void {
		this.map.delete(key);
	}
}

const draftText = (id: string, name: string) =>
	JSON.stringify({
		format: 1,
		savedAt: '2026-11-10T10:00:00.000Z',
		doc: emptyCourse(id, name),
		mode: 'teacher',
		selection: null,
		reserved: { blocks: [], lessons: [], steps: [] }
	} satisfies Draft);

function setup() {
	const storage = new FakeStorage();
	const store = new DocStore();
	const archived: ArchivedDraft[] = [];
	const session = new DraftSession(store, {
		storage,
		archive: async (record) => {
			archived.push(record);
		}
	});
	return { storage, store, archived, session };
}

/** Let the best-effort archive promise settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the draft of the open course', () => {
	it('a legacy single-course draft moves to its course’s key, copy first', async () => {
		const { storage, store, archived, session } = setup();
		const text = draftText('KURZ_A', 'Starý kurz');
		storage.setItem(DRAFT_KEY, text);
		expect(session.restore()).toBe(true);
		expect(store.doc.course_id).toBe('KURZ_A');
		expect(store.doc.name).toBe('Starý kurz');
		expect(storage.getItem(draftKeyFor('KURZ_A'))).toBe(text);
		expect(storage.getItem(DRAFT_KEY)).toBeNull();
		expect(storage.getItem(OPEN_KEY)).toBe('KURZ_A');
		expect(readMeta(storage, 'KURZ_A')?.name).toBe('Starý kurz');
		expect(session.key).toBe(draftKeyFor('KURZ_A'));
		await settled();
		expect(archived.map((a) => a.courseId)).toEqual(['KURZ_A']);
	});

	it('the pointer wins over a legacy draft, which stays untouched', () => {
		const { storage, store, session } = setup();
		storage.setItem(draftKeyFor('KURZ_A'), draftText('KURZ_A', 'Otevřený'));
		storage.setItem(OPEN_KEY, 'KURZ_A');
		storage.setItem(DRAFT_KEY, draftText('KURZ_LEGACY', 'Starý'));
		expect(session.restore()).toBe(true);
		expect(store.doc.course_id).toBe('KURZ_A');
		expect(storage.getItem(DRAFT_KEY)).not.toBeNull();
	});

	it('a corrupt legacy draft blocks and is not overwritten', () => {
		const { storage, session } = setup();
		storage.setItem(DRAFT_KEY, '{broken');
		expect(session.restore()).toBe(false);
		expect(session.status).toBe('blocked');
		expect(storage.getItem(DRAFT_KEY)).toBe('{broken');
		expect(session.key).toBe(DRAFT_KEY);
	});

	it('nothing stored restores nothing', () => {
		const { session } = setup();
		expect(session.restore()).toBe(false);
		expect(session.status).toBe('saving');
	});

	it('switching courses re-anchors the watch; the flush writes the open course', async () => {
		const { storage, store, archived, session } = setup();
		store.load(emptyCourse('KURZ_A', 'A'));
		session.use('KURZ_A');
		session.flush();
		store.load(emptyCourse('KURZ_B', 'B'));
		session.use('KURZ_B');
		expect(session.key).toBe(draftKeyFor('KURZ_B'));
		session.flush();
		expect(session.status).toBe('saved');
		expect(JSON.parse(storage.getItem(draftKeyFor('KURZ_B'))!).doc.name).toBe('B');
		// A's draft is untouched beside B's.
		expect(JSON.parse(storage.getItem(draftKeyFor('KURZ_A'))!).doc.name).toBe('A');
		expect(storage.getItem(OPEN_KEY)).toBe('KURZ_B');
		expect(readMeta(storage, 'KURZ_B')?.name).toBe('B');
		await settled();
		expect(archived.map((a) => a.courseId)).toEqual(['KURZ_A', 'KURZ_B']);
	});

	it('another tab’s write to the open course’s key pauses saving', () => {
		const { storage, store, session } = setup();
		store.load(emptyCourse('KURZ_A', 'A'));
		session.use('KURZ_A');
		session.flush();
		storage.setItem(draftKeyFor('KURZ_A'), draftText('KURZ_A', 'Jiná karta'));
		session.schedule();
		session.flush();
		expect(session.status).toBe('blocked');
		expect(JSON.parse(storage.getItem(draftKeyFor('KURZ_A'))!).doc.name).toBe('Jiná karta');
	});

	it('a flush that changes nothing writes nothing and keeps the timestamp', () => {
		const { storage, store, session } = setup();
		store.load(emptyCourse('KURZ_A', 'A'));
		session.use('KURZ_A');
		session.flush();
		const before = storage.getItem(draftKeyFor('KURZ_A'));
		session.schedule();
		session.flush();
		expect(session.status).toBe('saved');
		expect(storage.getItem(draftKeyFor('KURZ_A'))).toBe(before);
	});

	it('restoring a draft does not rewrite it — another tab keeps saving', () => {
		const { storage, session } = setup();
		const text = draftText('KURZ_A', 'A');
		storage.setItem(draftKeyFor('KURZ_A'), text);
		storage.setItem(OPEN_KEY, 'KURZ_A');
		expect(session.restore()).toBe(true);
		session.schedule();
		session.flush();
		expect(session.status).toBe('saved');
		expect(storage.getItem(draftKeyFor('KURZ_A'))).toBe(text);
	});

	it('another course’s key is not a conflict', () => {
		const { storage, store, session } = setup();
		store.load(emptyCourse('KURZ_A', 'A'));
		session.use('KURZ_A');
		session.flush();
		storage.setItem(draftKeyFor('KURZ_B'), draftText('KURZ_B', 'B'));
		session.schedule();
		session.flush();
		expect(session.status).toBe('saved');
	});

	it('a full storage evicts only courses with a confirmed durable copy', async () => {
		const { storage, store, session } = setup();
		storage.setItem(draftKeyFor('KURZ_A'), draftText('KURZ_A', 'A'));
		session.markArchived('KURZ_A');
		storage.limit = draftText('KURZ_B', 'B').length + 200;
		store.load(emptyCourse('KURZ_B', 'B'));
		session.use('KURZ_B');
		session.flush();
		expect(session.status).toBe('saved');
		expect(storage.getItem(draftKeyFor('KURZ_A'))).toBeNull();
		expect(storage.getItem(draftKeyFor('KURZ_B'))).not.toBeNull();
		await settled();
	});

	it('a full storage with nothing safe to evict reports the failure', () => {
		const { storage, store, session } = setup();
		storage.setItem(draftKeyFor('KURZ_A'), draftText('KURZ_A', 'A'));
		// No confirmed copy of A: it must not be evicted.
		storage.limit = draftText('KURZ_B', 'B').length + 200;
		store.load(emptyCourse('KURZ_B', 'B'));
		session.use('KURZ_B');
		session.flush();
		expect(session.status).toBe('error');
		expect(storage.getItem(draftKeyFor('KURZ_A'))).not.toBeNull();
		expect(storage.getItem(draftKeyFor('KURZ_B'))).toBeNull();
	});

	it('replacement backs up the blocked key before writing', () => {
		const { storage, session } = setup();
		storage.setItem(DRAFT_KEY, '{broken');
		session.restore();
		session.replace();
		expect(session.status).toBe('saved');
		const backups = [...storage.map.keys()].filter((k) => k.startsWith(`${DRAFT_KEY}:backup:`));
		expect(backups).toHaveLength(1);
		expect(storage.getItem(backups[0])).toBe('{broken');
	});
});
