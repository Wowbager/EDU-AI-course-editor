/**
 * Who a version belongs to.
 *
 * There is no login yet (docs/DECISIONS.md, "Still open" 3). Until there is, the
 * owner is a random key this browser made (`state/versions/server.ts`), sent in a
 * header, and the server keeps only its SHA-256 — the key itself is never written
 * down here, so the data directory cannot be used to impersonate anyone.
 *
 * The shape is the login's: an owner is an opaque id that resolves from a request.
 * When the editor learns who is signed in, `resolveOwner` returns `user_<id>` from
 * the session instead, and a key-owned history can be claimed by moving its
 * directory. Sharing a course between teachers is an access list on the course
 * (`courses/<id>/access.json`, planned), not a change to this function.
 */
import { createHash } from 'node:crypto';

export const WORKSPACE_HEADER = 'x-editor-workspace';

/** 32 random bytes, base64url, no padding. */
const KEY = /^[A-Za-z0-9_-]{43}$/;

export type Owner = { id: string; kind: 'workspace' };

export function resolveOwner(request: Request): Owner | null {
	const key = request.headers.get(WORKSPACE_HEADER);
	if (key === null || !KEY.test(key)) return null;
	return { id: `ws_${createHash('sha256').update(key).digest('hex')}`, kind: 'workspace' };
}
