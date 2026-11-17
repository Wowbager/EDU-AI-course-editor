import { describe, expect, it } from 'vitest';
import { sniffImage } from '../sniff';

const bytes = (...parts: (string | number[])[]) =>
	new Uint8Array(
		parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p))
	);

describe('sniffImage', () => {
	it('knows each picture the editor takes by its first bytes', () => {
		expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(sniffImage(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
		expect(sniffImage(bytes('GIF89a'))).toBe('image/gif');
		expect(sniffImage(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('image/webp');
		expect(sniffImage(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif');
		expect(sniffImage(bytes('BM', new Array(30).fill(0)))).toBe('image/bmp');
	});

	it('takes nothing else, whatever it is called', () => {
		expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
		expect(sniffImage(bytes('<!doctype html>'))).toBeNull();
		expect(sniffImage(bytes('%PDF-1.7'))).toBeNull();
		expect(sniffImage(bytes('RIFF', [1, 2, 3, 4], 'WAVE'))).toBeNull();
		expect(sniffImage(new Uint8Array())).toBeNull();
	});
});
