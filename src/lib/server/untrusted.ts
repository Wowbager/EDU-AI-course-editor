/**
 * Headers for a file the server passes on but did not write: an uploaded picture, or one
 * fetched from a teacher's link. It is shown in an `<img>`, where these change nothing;
 * opened on its own it may run nothing on the editor's origin (an SVG with a script, a
 * file that a browser might take for a page).
 */
export const UNTRUSTED_FILE_HEADERS = {
	'x-content-type-options': 'nosniff',
	'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox"
} as const;
