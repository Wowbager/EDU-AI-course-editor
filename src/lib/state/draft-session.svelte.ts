import type { DocStore } from './doc-store.svelte';
import type { CourseV2 } from '$lib/domain/schema';
import { serialiseToJson } from '$lib/domain/document';
import { DRAFT_KEY, readDraft, type Draft } from './draft';
import {
	DRAFT_PREFIX,
	draftKeyFor,
	otherDraftKeys,
	readOpenCourse,
	writeMeta,
	writeOpenCourse,
	type CourseStorage
} from './courses';
import { archiveDraft, type ArchivedDraft } from './draft-archive';

export interface DraftDeps {
	storage?: CourseStorage;
	/** The durable copy (`draft-archive.ts`); injected in tests. Best-effort. */
	archive?: (record: ArchivedDraft) => Promise<void>;
}

/**
 * Browser-only lifecycle; constructed in onMount, never during SSR.
 *
 * One session follows the open course. Its draft lives under the course's own
 * key, so switching courses (`use`) re-anchors the conflict watch instead of
 * overwriting another course's work, and two tabs on two courses save
 * independently. A build from before the switcher kept one draft under
 * `DRAFT_KEY`; `restore` migrates it to its course's key, copy first.
 */
export class DraftSession {
	status = $state<'saving' | 'saved' | 'error' | 'blocked'>('saving');
	message = $state('');
	#known: string | null = null;
	/**
	 * What the stored draft holds, without its timestamp. A flush that changes
	 * nothing writes nothing: restoring or opening a course is not an edit, and
	 * rewriting it would bump its „upraveno“ time and pause another tab editing
	 * the same course for no reason.
	 */
	#knownPayload: string | null = null;
	#key: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#store: DocStore;
	#storage: CourseStorage;
	#archive: (record: ArchivedDraft) => Promise<void>;
	/** Courses whose durable copy is confirmed — the only safe evictions. */
	#archived = new Set<string>();

	constructor(store: DocStore, deps: DraftDeps = {}) {
		this.#store = store;
		this.#storage = deps.storage ?? localStorage;
		const archive = deps.archive ?? archiveDraft;
		this.#archive = async (record) => {
			await archive(record);
			this.#archived.add(record.courseId);
		};
	}

	/** The key this session watches; another tab's write to it is a conflict. */
	get key(): string | null {
		return this.#key;
	}

	restore(): boolean {
		try {
			const open = readOpenCourse(this.#storage);
			const pointed = open === null ? null : draftKeyFor(open);
			const key =
				pointed !== null && this.#storage.getItem(pointed) !== null
					? pointed
					: this.#storage.getItem(DRAFT_KEY) !== null
						? DRAFT_KEY
						: null;
			if (key === null) return false;
			this.#key = key;
			this.#known = this.#storage.getItem(key);
			this.#knownPayload = this.#payloadOfStored(this.#known);
			const draft = readDraft(this.#known!);
			this.#load(draft);
			this.status = 'saved';
			this.message = 'Obnoven koncept uložený v tomto prohlížeči.';
			if (key === DRAFT_KEY) this.#migrateLegacy(draft);
			return true;
		} catch {
			this.status = 'blocked';
			this.message =
				'Uložený koncept nelze načíst nebo úložiště není dostupné. Původní data nebyla přepsána.';
			return false;
		}
	}

	#load(draft: Draft) {
		this.#store.load(draft.doc);
		this.#store.restoreReservations(draft.reserved);
		this.#store.mode = draft.mode;
		this.#store.showFeedback = draft.feedbackVisible ?? true;
		this.#store.selection = draft.selection;
		this.#store.dirty = true;
	}

	/** The single-course draft becomes its course's own key. The copy exists before the old key goes. */
	#migrateLegacy(draft: Draft) {
		const id = draft.doc.course_id;
		const text = this.#known!;
		this.#storage.setItem(draftKeyFor(id), text);
		writeMeta(this.#storage, id, draft.doc.name ?? '', draft.savedAt);
		writeOpenCourse(this.#storage, id);
		this.#storage.removeItem(DRAFT_KEY);
		this.#key = draftKeyFor(id);
		void this.#archive({
			courseId: id,
			name: draft.doc.name ?? '',
			savedAt: draft.savedAt,
			text
		}).catch(() => {});
	}

	/**
	 * Another course is open now. The watch moves to its key; what that key holds
	 * is the baseline a concurrent write is measured against.
	 */
	use(courseId: string) {
		clearTimeout(this.#timer);
		this.#key = draftKeyFor(courseId);
		this.#known = this.#storage.getItem(this.#key);
		this.#knownPayload = this.#payloadOfStored(this.#known);
		this.status = 'saving';
		this.message = '';
		writeOpenCourse(this.#storage, courseId);
	}

	/** The draft's durable values in the domain's canonical form, timestamp aside. */
	#payload(
		doc: CourseV2,
		mode: string,
		feedbackVisible: boolean,
		selection: unknown,
		reserved: unknown
	): string {
		return JSON.stringify({
			doc: serialiseToJson(doc, 0),
			mode,
			feedbackVisible,
			selection,
			reserved
		});
	}

	#payloadOfStored(text: string | null): string | null {
		if (text === null) return null;
		try {
			const draft = JSON.parse(text) as Draft;
			return this.#payload(
				draft.doc,
				draft.mode,
				draft.feedbackVisible ?? true,
				draft.selection,
				draft.reserved
			);
		} catch {
			return null;
		}
	}

	/** A durable copy of this course is known to exist (read back from the archive). */
	markArchived(courseId: string) {
		this.#archived.add(courseId);
	}

	schedule() {
		if (this.status === 'blocked') return;
		this.status = 'saving';
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => this.flush(), 400);
	}

	flush() {
		clearTimeout(this.#timer);
		if (this.status === 'blocked' || this.status === 'saved') return;
		try {
			if (this.#key !== null && this.#storage.getItem(this.#key) !== this.#known) {
				this.conflict();
				return;
			}
			const store = this.#store;
			const reserved = {
				blocks: [...store.reservations.blocks],
				lessons: [...store.reservations.lessons],
				steps: [...store.reservations.steps]
			};
			const payload = this.#payload(
				store.source,
				store.mode,
				store.showFeedback,
				store.selection,
				reserved
			);
			// Nothing changed since the stored draft: no write, no new timestamp,
			// no conflict for another tab that merely restored the same course.
			if (this.#known !== null && payload === this.#knownPayload) {
				this.status = 'saved';
				return;
			}
			const draft: Draft = {
				format: 1,
				savedAt: new Date().toISOString(),
				doc: store.source,
				mode: store.mode,
				feedbackVisible: store.showFeedback,
				selection: store.selection,
				reserved
			};
			const text = JSON.stringify(draft);
			const id = store.doc.course_id;
			const key = draftKeyFor(id);
			try {
				this.#storage.setItem(key, text);
			} catch (full) {
				// The quota, most likely. Other courses' drafts that have a confirmed
				// durable copy can go — their meta stays and they open from the archive.
				// A tab still editing an evicted course sees its key vanish and pauses,
				// which protects its work; nothing is lost.
				let freed = false;
				for (const other of otherDraftKeys(this.#storage, id)) {
					if (this.#archived.has(other.slice(DRAFT_PREFIX.length))) {
						this.#storage.removeItem(other);
						freed = true;
					}
				}
				if (!freed) throw full;
				this.#storage.setItem(key, text);
			}
			writeMeta(this.#storage, id, store.doc.name ?? '', draft.savedAt);
			writeOpenCourse(this.#storage, id);
			this.#known = text;
			this.#knownPayload = payload;
			this.#key = key;
			this.status = 'saved';
			void this.#archive({
				courseId: id,
				name: store.doc.name ?? '',
				savedAt: draft.savedAt,
				text
			}).catch(() => {});
		} catch {
			this.status = 'error';
			this.message =
				'Koncept se nepodařilo uložit. Nezavírej tuto kartu; úložiště může být plné nebo zakázané.';
		}
	}

	conflict() {
		clearTimeout(this.#timer);
		this.status = 'blocked';
		this.message =
			'Koncept v úložišti se změnil v jiné kartě. Automatické ukládání je pozastaveno, aby se práce nepřepsala.';
	}

	/** Explicitly archive the old record before authorizing replacement. */
	replace() {
		try {
			const key = this.#key ?? draftKeyFor(this.#store.doc.course_id);
			const previous = this.#storage.getItem(key);
			if (previous !== null) this.#storage.setItem(`${key}:backup:${Date.now()}`, previous);
			this.#known = previous;
			this.#knownPayload = this.#payloadOfStored(previous);
			this.status = 'saving';
			this.flush();
		} catch {
			this.status = 'blocked';
			this.message = 'Původní koncept nelze zálohovat. Nebyl přepsán.';
		}
	}

	dispose() {
		clearTimeout(this.#timer);
	}
}
