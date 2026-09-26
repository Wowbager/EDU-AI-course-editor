import { describe, expect, it } from 'vitest';
import { emptyCourse } from '$lib/domain/document';
import { MemoryBackend, type VersionBackend } from './backend';
import { VersionStore } from './version-store.svelte';

const course = () => ({ ...emptyCourse('C1', 'Fotosyntéza'), lessons: [] });

class Failing implements VersionBackend {
	readonly name = 'server' as const;
	index = () => Promise.reject(new Error('down'));
	get = () => Promise.reject(new Error('down'));
	put = () => Promise.reject(new Error('down'));
	setPublished = () => Promise.reject(new Error('down'));
}

describe('version store', () => {
	it('saves, lists and republishes', async () => {
		const store = new VersionStore([new MemoryBackend()]);
		await store.load('C1');
		const v1 = await store.save(course(), 'první');
		expect(v1.version).toBe(1);
		const out = await store.publish(1, 'public', course());
		expect(out).toMatchObject({ version: 1, status: 'published' });
		// The same version again, now for signed-in students only: a new number.
		const again = await store.publish(1, 'logged_only', course());
		expect(again).toMatchObject({ version: 2, logged_only: true });
		void Failing;
	});
});

describe('merging what is kept where', () => {
	it('copies a version to a backend that lacks it, and reports one that is down', async () => {
		const browser = new MemoryBackend('browser');
		const server = new MemoryBackend('server');
		const first = new VersionStore([browser]);
		await first.load('C1');
		await first.save(course(), 'jen v prohlížeči');

		const both = new VersionStore([browser, server]);
		await both.load('C1');
		await new Promise((r) => setTimeout(r, 0));
		expect((await server.index('C1')).versions.map((v) => v.version)).toEqual([1]);

		const degraded = new VersionStore([browser, new Failing()]);
		await degraded.load('C1');
		expect(degraded.unavailable).toEqual(['server']);
		expect(degraded.versions.map((v) => v.version)).toEqual([1]);
	});

	it('skips a number another tab took, instead of overwriting it', async () => {
		const shared = new MemoryBackend('browser');
		const a = new VersionStore([shared]);
		const b = new VersionStore([shared]);
		await a.load('C1');
		await b.load('C1');
		await a.save(course(), 'z karty A');
		const other = { ...course(), name: 'Jiný obsah' };
		const saved = await b.save(other, 'z karty B');
		expect(saved.version).toBe(2);
	});

	it('records an imported course as the version it was published under', async () => {
		const store = new VersionStore([new MemoryBackend()]);
		await store.recordImport({ ...course(), version: 6 });
		expect(store.versions.map((v) => [v.version, v.origin])).toEqual([[6, 'import']]);
		expect(store.next({ ...course(), version: 6 })).toBe(7);
	});
});
