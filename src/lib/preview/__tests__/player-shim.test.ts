import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `player-shim.js` is plain JS injected verbatim into the player's page (see its own
 * doc comment, and `scripts/inject-player-shim.mjs`) — it is deliberately not a
 * module, so it can't be `import`ed like ordinary TypeScript. These tests load its
 * actual source text into a `vm` sandbox standing in for a browser global scope, so
 * what is tested is the real file that ships, not a re-implementation of its regex.
 */
const source = readFileSync(
	fileURLToPath(new URL('../player-shim.js', import.meta.url)),
	'utf-8'
);

class FakeRequest {
	url: string;
	method: string;
	headers: unknown;
	mode: unknown;
	credentials: unknown;
	cache: unknown;
	redirect: unknown;
	referrer: unknown;
	constructor(url: string, init: Record<string, unknown> = {}) {
		this.url = url;
		this.method = (init.method as string) ?? 'GET';
		this.headers = init.headers;
		this.mode = init.mode;
		this.credentials = init.credentials;
		this.cache = init.cache;
		this.redirect = init.redirect;
		this.referrer = init.referrer;
	}
}

interface Sandbox {
	window: Sandbox;
	fetch: (...args: unknown[]) => Promise<unknown>;
	XMLHttpRequest: typeof FakeXHR;
	Request: typeof FakeRequest;
	[key: string]: unknown;
}

class FakeXHR {
	static openCalls: unknown[][] = [];
	open(...args: unknown[]) {
		FakeXHR.openCalls.push(args);
	}
}

/** Runs the shim's real source in a fresh sandbox standing in for `window`. */
function loadShim() {
	FakeXHR.openCalls = [];
	const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
	const sandbox = {
		fetch: fetchMock,
		XMLHttpRequest: FakeXHR,
		Request: FakeRequest
	} as unknown as Sandbox;
	// Real browsers have `window === globalThis`, so patching `window.fetch` is the
	// same object as patching bare `fetch`. Mirrored here so the shim's own
	// `window.fetch = ...` line has the effect it has in a real page.
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(source, sandbox, { filename: 'player-shim.js' });
	return { sandbox, fetchMock };
}

describe('player-shim: fetch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rewrites a proxy URL string to the same-origin preview-image endpoint, preserving the encoded value exactly', async () => {
		const { sandbox, fetchMock } = loadShim();
		const encoded = 'https%3A%2F%2Fupload.wikimedia.org%2Ffoo%2Fbar.png%3Fa%3D1%26b%3D2';
		const proxyUrl = `https://app-api.edu-ai.eu/api/proxy/image?url=${encoded}`;

		await sandbox.fetch(proxyUrl);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(`/preview-image?url=${encoded}`);
	});

	it('rewrites a relative proxy URL too', async () => {
		const { sandbox, fetchMock } = loadShim();
		await sandbox.fetch('/api/proxy/image?url=https%3A%2F%2Fexample.com%2Fx.png');
		expect(fetchMock.mock.calls[0][0]).toBe('/preview-image?url=https%3A%2F%2Fexample.com%2Fx.png');
	});

	it('passes an unrelated string URL through untouched', async () => {
		const { sandbox, fetchMock } = loadShim();
		await sandbox.fetch('https://app-api.edu-ai.eu/api/user/stats');
		expect(fetchMock).toHaveBeenCalledWith('https://app-api.edu-ai.eu/api/user/stats', undefined);
	});

	it('preserves the init object on a rewritten call', async () => {
		const { sandbox, fetchMock } = loadShim();
		const init = { mode: 'cors' };
		await sandbox.fetch('/api/proxy/image?url=abc', init);
		expect(fetchMock.mock.calls[0]).toEqual(['/preview-image?url=abc', init]);
	});

	it('rewrites a Request object by rebuilding it, rather than mutating the read-only url', async () => {
		const { sandbox, fetchMock } = loadShim();
		const request = new sandbox.Request('https://app-api.edu-ai.eu/api/proxy/image?url=xyz', {
			method: 'GET'
		});

		await sandbox.fetch(request);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const passed = fetchMock.mock.calls[0][0] as FakeRequest;
		expect(passed).toBeInstanceOf(FakeRequest);
		expect(passed.url).toBe('/preview-image?url=xyz');
	});

	it('passes a non-matching Request object through unchanged', async () => {
		const { sandbox, fetchMock } = loadShim();
		const request = new sandbox.Request('https://example.com/unrelated.png');

		await sandbox.fetch(request);

		expect(fetchMock).toHaveBeenCalledWith(request, undefined);
	});

	it('is inert for input shapes it does not recognise, without throwing', async () => {
		const { sandbox, fetchMock } = loadShim();

		await expect(sandbox.fetch(undefined)).resolves.toBeDefined();
		await expect(sandbox.fetch(123)).resolves.toBeDefined();
		await expect(sandbox.fetch({})).resolves.toBeDefined();
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe('player-shim: XMLHttpRequest', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('rewrites a proxy URL passed to open(), preserving trailing arguments', () => {
		const { sandbox } = loadShim();
		const xhr = new sandbox.XMLHttpRequest();
		xhr.open('GET', 'https://app-api.edu-ai.eu/api/proxy/image?url=abc%3D1', true);

		expect(FakeXHR.openCalls).toEqual([['GET', '/preview-image?url=abc%3D1', true]]);
	});

	it('passes an unrelated URL through untouched', () => {
		const { sandbox } = loadShim();
		const xhr = new sandbox.XMLHttpRequest();
		xhr.open('POST', 'https://app-api.edu-ai.eu/api/user/stats');

		expect(FakeXHR.openCalls).toEqual([['POST', 'https://app-api.edu-ai.eu/api/user/stats']]);
	});

	it('does not throw for a non-string url', () => {
		const { sandbox } = loadShim();
		const xhr = new sandbox.XMLHttpRequest();
		expect(() => xhr.open('GET', null)).not.toThrow();
	});
});
