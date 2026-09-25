import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where the Flutter web build is, resolved the same way `vite.config.ts` resolves it
 * for the dev server — so a `PLAYER_BUILD` that points the preview somewhere else
 * points these suites there too, rather than at a sibling checkout that may be stale
 * or absent.
 *
 * Without a build the player suites skip, which is right for someone working on the
 * editor alone and wrong for anyone claiming the preview works: `REQUIRE_PLAYER=1`
 * turns the skip into a failure, so "all green" cannot quietly mean "not run".
 */
const dir = resolve(process.env.PLAYER_BUILD ?? '../EDU-AI-asistent-APP/build/web');

export const playerBuilt = existsSync(resolve(dir, 'index.html'));

if (!playerBuilt && process.env.REQUIRE_PLAYER) {
	throw new Error(`REQUIRE_PLAYER is set but there is no Flutter web build at ${dir}`);
}
