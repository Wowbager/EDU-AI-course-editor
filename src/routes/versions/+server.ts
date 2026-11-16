/**
 * The owner's courses on the editor's server (`lib/server/versions/`).
 * Not under `/api/`: nginx sends that to the Laravel API.
 *
 *   GET /versions   one summary per course (name, newest number, when), for the
 *                   course switcher — a course whose draft this browser lost is
 *                   still findable here while the workspace key survives.
 */
import { answer, ownerOf } from '$lib/server/versions/http';
import { versionFiles } from '$lib/server/versions/instance';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) =>
	answer(() => versionFiles().list(ownerOf(request)));
