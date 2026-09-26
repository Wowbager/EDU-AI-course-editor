/**
 * Course versions and who can see a published course — the headless half of the
 * editor's version control.
 *
 * What exists upstream decides the shape. The API keeps one row per course and takes
 * an upload only when its `version` is strictly higher than the stored one; the app
 * offers a student an update only when the number goes up (spec §2). So a version
 * here is a numbered, frozen copy of the whole document, numbers only ever grow, and
 * "make version 3 the published one again" after version 5 was out has to become a
 * *new* version 6 with version 3's content — anything else would be refused by the
 * API, or silently ignored by every app that already has 5.
 *
 * Visibility is not a new key. It is the two the platform already reads:
 * `status` (only `published` is listed; `private` is reachable by PIN) and
 * `logged_only` (guests are asked to sign in). The spec's own `locked` means "frozen
 * for review, hidden from students" (§3.5), so "only for signed-in students" is not
 * called that here, however tempting the word.
 */
import type { CourseV2 } from './schema';
import { serialiseToJson } from './document';

export type Visibility = 'private' | 'public' | 'logged_only' | 'draft' | 'approved' | 'locked';

/** What a teacher chooses between. The rest is the metodik's editorial workflow. */
export const TEACHER_VISIBILITIES: readonly Visibility[] = ['private', 'public', 'logged_only'];
export const ALL_VISIBILITIES: readonly Visibility[] = [
	'private',
	'public',
	'logged_only',
	'draft',
	'approved',
	'locked'
];

export const VISIBILITY_LABEL: Record<Visibility, { label: string; title: string }> = {
	private: {
		label: 'Soukromý',
		title: 'Kurz není v knihovně. Otevře ho jen žák, kterému dáš PIN kurzu.'
	},
	public: { label: 'Veřejný', title: 'Kurz je v knihovně a otevře ho kdokoli, i bez přihlášení.' },
	logged_only: {
		label: 'Jen pro přihlášené',
		title: 'Kurz je v knihovně, ale otevřít ho může jen přihlášený žák. Host je vyzván k přihlášení.'
	},
	draft: { label: 'Rozpracovaný', title: 'Žák kurz nevidí vůbec.' },
	approved: { label: 'Schválený', title: 'Schválený, čeká na vydání. Žák ho zatím nevidí.' },
	locked: { label: 'K revizi', title: 'Zamčený na dobu revize. Žák ho nevidí a úpravy by měly počkat.' }
};

/** How the document currently reads, in those terms. */
export function visibilityOf(doc: Pick<CourseV2, 'status' | 'logged_only'>): Visibility {
	switch (doc.status) {
		case 'published':
			return doc.logged_only === true ? 'logged_only' : 'public';
		case 'private':
			return 'private';
		case 'approved':
		case 'locked':
			return doc.status;
		default:
			return 'draft';
	}
}

/**
 * Write a visibility into a document: `status`, and `logged_only` only where it
 * matters. Nothing else is touched, and `logged_only` is removed rather than written
 * as `false` — parsing never injects defaults, and neither does this.
 */
export function applyVisibility(doc: CourseV2, visibility: Visibility): CourseV2 {
	const status = visibility === 'public' || visibility === 'logged_only' ? 'published' : visibility;
	const next: CourseV2 = { ...doc, status };
	if (visibility === 'logged_only') next.logged_only = true;
	else if (next.logged_only === true) delete next.logged_only;
	return next;
}

export interface VersionMeta {
	courseId: string;
	version: number;
	/** ISO timestamp. */
	savedAt: string;
	note?: string;
	/** The version this one was restored from, when it is a re-publication. */
	restoredFrom?: number;
	/** `contentHash` of the document, to tell "unchanged since" without loading it. */
	hash: string;
	/** Where it came from: saved in the editor, or the file the course was imported from. */
	origin?: 'saved' | 'import';
}

export interface CourseVersion extends VersionMeta {
	doc: CourseV2;
}

export interface Publication {
	version: number;
	visibility: Visibility;
	at: string;
}

export interface VersionIndex {
	courseId: string;
	versions: VersionMeta[];
	published?: Publication;
}

export const emptyIndex = (courseId: string): VersionIndex => ({ courseId, versions: [] });

/**
 * What identifies the content of a version. The number and the visibility are left
 * out: they are *about* the version, and two copies differing only in them are the
 * same course — which is what "unchanged since version 3" has to mean.
 */
export function contentHash(doc: CourseV2): string {
	const { version: _version, status: _status, logged_only: _loggedOnly, ...content } = doc;
	void _version;
	void _status;
	void _loggedOnly;
	return fnv1a(serialiseToJson(content as CourseV2, 0));
}

function fnv1a(text: string): string {
	// Two 32-bit FNV-1a lanes with different offsets: short, dependency-free, and far
	// more than enough to tell a teacher's versions of one course apart.
	let a = 0x811c9dc5;
	let b = 0x01000193 ^ 0x5bd1e995;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193) >>> 0;
		b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
	}
	return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export const latest = (index: VersionIndex): VersionMeta | undefined =>
	index.versions.reduce<VersionMeta | undefined>(
		(best, v) => (best === undefined || v.version > best.version ? v : best),
		undefined
	);

/**
 * The number the working copy will be saved as. Always above every saved version,
 * and never below the document's own number — an imported file that was published
 * as 6 cannot come back as 1.
 */
export function nextVersion(index: VersionIndex, doc: Pick<CourseV2, 'version'>): number {
	const saved = latest(index)?.version ?? 0;
	const own = typeof doc.version === 'number' && doc.version > 0 ? doc.version : 1;
	return Math.max(saved + 1, saved === 0 ? own : 0);
}

/** A frozen copy of the working document as version `number`. */
export function snapshot(
	doc: CourseV2,
	number: number,
	now: Date,
	extra: Pick<VersionMeta, 'note' | 'restoredFrom' | 'origin'> = {}
): CourseVersion {
	const frozen: CourseV2 = { ...structuredClone(doc), version: number };
	return {
		courseId: doc.course_id,
		version: number,
		savedAt: now.toISOString(),
		hash: contentHash(frozen),
		...(extra.note !== undefined && extra.note.trim() !== '' ? { note: extra.note.trim() } : {}),
		...(extra.restoredFrom !== undefined ? { restoredFrom: extra.restoredFrom } : {}),
		...(extra.origin !== undefined ? { origin: extra.origin } : {}),
		doc: frozen
	};
}

export type PublishPlan =
	| { kind: 'publish'; version: number }
	/** An older version goes out again under a new number, because numbers only grow. */
	| { kind: 'republish'; from: number; version: number };

export function publishPlan(index: VersionIndex, version: number, workingDoc: Pick<CourseV2, 'version'>): PublishPlan {
	const published = index.published?.version;
	// Anything above what is out goes out under its own number: nothing above
	// `published` was ever out, so the number still only grows.
	if (published === undefined || version > published) return { kind: 'publish', version };
	const newest = latest(index)?.version ?? 0;
	return { kind: 'republish', from: version, version: Math.max(newest + 1, nextVersion(index, workingDoc)) };
}

/** The document as it is handed to the platform: numbered, with its visibility. */
export function publishedDocument(version: CourseVersion, number: number, visibility: Visibility): CourseV2 {
	return applyVisibility({ ...version.doc, version: number }, visibility);
}

export interface DiffSummary {
	added: number;
	removed: number;
	changed: number;
	lessonsChanged: boolean;
}

/** What changed between two versions, in cards — what a metodik reads before publishing. */
export function summariseDiff(from: CourseV2, to: CourseV2): DiffSummary {
	const before = new Map(from.blocks.map((b) => [b.block_id, JSON.stringify(b)]));
	const after = new Map(to.blocks.map((b) => [b.block_id, JSON.stringify(b)]));
	let added = 0;
	let removed = 0;
	let changed = 0;
	for (const [id, json] of after) {
		const old = before.get(id);
		if (old === undefined) added++;
		else if (old !== json) changed++;
	}
	for (const id of before.keys()) if (!after.has(id)) removed++;
	return { added, removed, changed, lessonsChanged: JSON.stringify(from.lessons) !== JSON.stringify(to.lessons) };
}
