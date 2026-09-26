import { describe, expect, it } from 'vitest';
import { courseFileName } from '../filename';
import { newCourseId } from '../ids';

describe('the downloaded file', () => {
	it('is named after the course, not its id', () => {
		expect(courseFileName('Úvod do fotosyntézy')).toBe('uvod-do-fotosyntezy.json');
		expect(courseFileName('Zlomky pro 5. třídu!')).toBe('zlomky-pro-5-tridu.json');
	});
	it('falls back when the name has nothing a file system can keep', () => {
		expect(courseFileName('')).toBe('kurz.json');
		expect(courseFileName('???')).toBe('kurz.json');
		expect(courseFileName(undefined, 'KURZ_X')).toBe('KURZ_X.json');
	});
	it('can carry a version', () => {
		expect(courseFileName('Zlomky', 'kurz', '-v3')).toBe('zlomky-v3.json');
	});
});

describe('a new course id', () => {
	it('differs between two new courses', () => {
		const ids = new Set(Array.from({ length: 200 }, () => newCourseId()));
		expect(ids.size).toBe(200);
	});
	it('has the shape of a storage key', () => {
		expect(newCourseId()).toMatch(/^KURZ_[A-Z0-9]{10}$/);
	});
});
