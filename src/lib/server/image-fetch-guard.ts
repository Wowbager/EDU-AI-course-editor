/**
 * Guards for fetching an *author-supplied* image URL from the server.
 *
 * `routes/preview-image` fetches whatever URL a teacher pasted into a course, from
 * inside the editor's own server process — the whole point being that a server has no
 * CORS to fight. That also makes it a classic SSRF surface: a request the server makes
 * on the teacher's behalf can be pointed at the server's own metadata endpoint, another
 * container on the same network, or anything else `curl 127.0.0.1` would reach from
 * inside. This module is the checklist that keeps that fetch honest. It is deliberately
 * kept separate from the route so it can be unit tested without spinning up a server.
 *
 * What it protects against:
 *  - fetching a non-http(s) scheme (`file:`, `data:`, `gopher:`, …);
 *  - fetching a hostname that resolves to loopback, link-local, or private
 *    (RFC1918 / IPv6 unique-local) address space — including one reached only after
 *    a redirect, because redirects are followed manually with the same check applied
 *    to every hop;
 *  - a response that never stops (a 10s wall-clock budget) or never ends (a 20MB cap);
 *  - a response whose declared type is not an image, which is both a sanity check and
 *    a way to reject e.g. an internal JSON API that happened to pass the address check.
 *
 * What it does **not** protect against:
 *  - DNS rebinding. The hostname is resolved once, checked, and then handed to
 *    `fetch`/`undici`, which resolves it *again* to actually connect. A DNS server
 *    that answers the first lookup with a public address and the second with
 *    `127.0.0.1` slips through — closing that gap needs connecting to a pinned IP
 *    (e.g. via a custom `dns.lookup` / agent) rather than letting the HTTP client
 *    re-resolve the name, which is more machinery than this internal preview tool
 *    currently warrants. Documented here so it is a decision, not an oversight.
 *  - a host that is public but hostile (serves malware, an oversized image that
 *    happens to sit just under the cap, a redirect loop that happens to terminate
 *    just under the hop limit). This module is about *where the request can go*, not
 *    about what a public server is allowed to send back.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB
export const FETCH_TIMEOUT_MS = 10_000; // wall clock, connect through last byte
export const MAX_REDIRECTS = 5;

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

export class UnsafeUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UnsafeUrlError';
	}
}

/** `Uri.encodeComponent` on the Flutter side only ever produces `http(s):` URLs, but
 * nothing stops a teacher pasting `file:///etc/passwd` or `data:...` by hand. */
export function isAllowedScheme(url: URL): boolean {
	return ALLOWED_SCHEMES.has(url.protocol);
}

/**
 * True for an IPv4 address in loopback, link-local, RFC1918 private, or the other
 * reserved ranges a server has no business fetching on a teacher's behalf.
 */
export function isReservedIPv4(address: string): boolean {
	const parts = address.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
	const [a, b] = parts;
	if (a === 127) return true; // loopback
	if (a === 10) return true; // RFC1918
	if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
	if (a === 192 && b === 168) return true; // RFC1918
	if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata, 169.254.169.254)
	if (a === 0) return true; // "this network"
	if (a >= 224) return true; // multicast + reserved (224-255)
	return false;
}

/**
 * True for an IPv6 address in loopback, link-local, unique-local, or an IPv4-mapped
 * address whose embedded IPv4 is itself reserved.
 */
export function isReservedIPv6(address: string): boolean {
	const normalised = address.toLowerCase();
	if (normalised === '::1') return true; // loopback
	if (normalised === '::') return true; // unspecified
	// IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — unwrap and re-check as IPv4.
	const mapped = normalised.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) return isReservedIPv4(mapped[1]);
	if (normalised.startsWith('fe80:') || normalised.startsWith('fe8') || normalised.startsWith('fe9')) return true; // link-local fe80::/10
	if (normalised.startsWith('fea') || normalised.startsWith('feb')) return true;
	if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true; // unique local fc00::/7
	return false;
}

/** Dispatches an address string to the IPv4 or IPv6 check, whichever it is. */
export function isReservedAddress(address: string): boolean {
	const version = isIP(address);
	if (version === 4) return isReservedIPv4(address);
	if (version === 6) return isReservedIPv6(address);
	// Not a literal IP — callers should resolve it first. Treated as unsafe rather
	// than silently passing something this function cannot actually evaluate.
	return true;
}

export type LookupFn = (
	hostname: string,
	options: { all: true }
) => Promise<Array<{ address: string; family: number }>>;

/**
 * Resolves `hostname` and throws `UnsafeUrlError` if any resulting address is
 * reserved. Every address is checked, not just the first, because a hostname can
 * round-robin between a public and a private address.
 *
 * Note the DNS-rebinding caveat in the module doc comment: this check and the
 * connection `fetch` makes afterwards are two separate lookups.
 */
export async function assertPublicHost(hostname: string, lookup: LookupFn = dnsLookup): Promise<void> {
	// A literal IP address needs no DNS lookup — and dns.lookup() on some platforms
	// mishandles bracketed IPv6 literals — so check it directly.
	const literalVersion = isIP(hostname);
	if (literalVersion !== 0) {
		if (isReservedAddress(hostname)) {
			throw new UnsafeUrlError(`refusing to fetch ${hostname}: it is a reserved address`);
		}
		return;
	}

	let records: Array<{ address: string; family: number }>;
	try {
		records = await lookup(hostname, { all: true });
	} catch (error) {
		throw new UnsafeUrlError(
			`refusing to fetch ${hostname}: DNS lookup failed (${error instanceof Error ? error.message : String(error)})`
		);
	}
	if (records.length === 0) {
		throw new UnsafeUrlError(`refusing to fetch ${hostname}: it did not resolve to any address`);
	}
	for (const { address } of records) {
		if (isReservedAddress(address)) {
			throw new UnsafeUrlError(`refusing to fetch ${hostname}: resolves to reserved address ${address}`);
		}
	}
}

/** Scheme + host safe to fetch. Throws `UnsafeUrlError` otherwise. */
export async function assertSafeUrl(url: URL, lookup: LookupFn = dnsLookup): Promise<void> {
	if (!isAllowedScheme(url)) {
		throw new UnsafeUrlError(`refusing to fetch ${url.protocol} — only http/https are allowed`);
	}
	await assertPublicHost(url.hostname, lookup);
}

const ALLOWED_CONTENT_TYPE = /^image\//i;

/** `image/png`, `image/svg+xml`, `image/jpeg; charset=binary`, … — anything else is
 * rejected even if the address checks all passed, since an internal service that
 * happens to sit at a public address is still not an image host. */
export function isAllowedImageContentType(contentType: string | null | undefined): boolean {
	if (!contentType) return false;
	const mime = contentType.split(';')[0]?.trim() ?? '';
	return ALLOWED_CONTENT_TYPE.test(mime);
}

export interface SafeFetchResult {
	ok: boolean;
	/** Present when `ok`. Its body is wrapped to enforce `MAX_BODY_BYTES`. */
	response?: Response;
	/** Present when `!ok` — short enough to go straight into the 502 body the route
	 * sends an author, naming exactly what was tried. */
	error?: string;
}

export interface FetchImageSafelyOptions {
	lookup?: LookupFn;
	fetchFn?: typeof fetch;
}

/**
 * Fetches `rawUrl` the way an author-supplied image URL must be fetched: scheme and
 * address checked before every connection — including every redirect hop, which is
 * why redirects are followed by hand (`redirect: 'manual'`) instead of left to
 * `fetch` — a single wall-clock budget for the whole thing, and the body capped as it
 * streams rather than after the fact.
 *
 * `lookup`/`fetchFn` are injectable so tests can exercise the address logic and the
 * redirect loop without touching the network.
 */
export async function fetchImageSafely(
	rawUrl: string,
	options: FetchImageSafelyOptions = {}
): Promise<SafeFetchResult> {
	const lookup = options.lookup ?? dnsLookup;
	const fetchFn = options.fetchFn ?? fetch;

	let current: URL;
	try {
		current = new URL(rawUrl);
	} catch {
		return { ok: false, error: `not a valid URL: ${rawUrl}` };
	}

	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error(`timed out after ${FETCH_TIMEOUT_MS}ms`)),
		FETCH_TIMEOUT_MS
	);
	const clear = () => clearTimeout(timer);

	for (let hop = 0; ; hop++) {
		try {
			await assertSafeUrl(current, lookup);
		} catch (error) {
			clear();
			return { ok: false, error: error instanceof Error ? error.message : String(error) };
		}

		let response: Response;
		try {
			response = await fetchFn(current, { redirect: 'manual', signal: controller.signal });
		} catch (error) {
			clear();
			return {
				ok: false,
				error: `network error fetching ${current}: ${error instanceof Error ? error.message : String(error)}`
			};
		}

		if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
			if (hop >= MAX_REDIRECTS) {
				clear();
				return { ok: false, error: `too many redirects (> ${MAX_REDIRECTS})` };
			}
			try {
				// Resolved against the current URL, then checked again at the top of the
				// loop — a redirect to a private address must be caught exactly like one
				// pasted directly.
				current = new URL(response.headers.get('location')!, current);
			} catch {
				clear();
				return { ok: false, error: `redirected to an unparsable location` };
			}
			continue;
		}

		if (!response.ok) {
			clear();
			return { ok: false, error: `upstream responded ${response.status} ${response.statusText}`.trim() };
		}

		if (!isAllowedImageContentType(response.headers.get('content-type'))) {
			clear();
			return {
				ok: false,
				error: `unexpected content-type: ${response.headers.get('content-type') ?? '(none)'}`
			};
		}

		const declaredLength = Number(response.headers.get('content-length') ?? '');
		if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
			clear();
			return { ok: false, error: `declared size ${declaredLength} exceeds ${MAX_BODY_BYTES} bytes` };
		}

		return { ok: true, response: capResponseBody(response, MAX_BODY_BYTES, clear) };
	}
}

/**
 * Wraps `response.body` so a stream that never ends — or ends after more than
 * `maxBytes` — is cut off rather than buffered without limit. `onSettled` fires
 * exactly once, whether the stream finishes, is cut off, or the consumer cancels it,
 * so the caller can retire the timeout that is still guarding this phase.
 */
function capResponseBody(response: Response, maxBytes: number, onSettled: () => void): Response {
	if (!response.body) {
		onSettled();
		return response;
	}

	const reader = response.body.getReader();
	let total = 0;
	let settled = false;
	const settle = () => {
		if (settled) return;
		settled = true;
		onSettled();
	};

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			let chunk: ReadableStreamReadResult<Uint8Array>;
			try {
				chunk = await reader.read();
			} catch (error) {
				settle();
				controller.error(error);
				return;
			}
			if (chunk.done) {
				settle();
				controller.close();
				return;
			}
			total += chunk.value.byteLength;
			if (total > maxBytes) {
				settle();
				controller.error(new Error(`response body exceeded ${maxBytes} bytes`));
				reader.cancel().catch(() => {});
				return;
			}
			controller.enqueue(chunk.value);
		},
		cancel(reason) {
			settle();
			return reader.cancel(reason);
		}
	});

	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}
