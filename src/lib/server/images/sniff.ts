/**
 * What an uploaded picture is, by its first bytes, not by what the browser said: a file
 * the server keeps and serves to anyone is the type its contents are, or it is refused.
 */

const ascii = (bytes: Uint8Array, at: number, text: string) =>
	bytes.length >= at + text.length &&
	[...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));

const starts = (bytes: Uint8Array, prefix: number[]) =>
	bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/** The picture's MIME type, or `null` when it is none the editor takes. */
export function sniffImage(bytes: Uint8Array): string | null {
	if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'image/gif';
	if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'image/webp';
	if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis')))
		return 'image/avif';
	if (ascii(bytes, 0, 'BM') && bytes.length >= 26) return 'image/bmp';
	return null;
}
