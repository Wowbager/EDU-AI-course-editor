/**
 * How many lessons the browser may write at once. Over HTTP/2 or HTTP/3 every request
 * shares one connection, so every lesson goes at once. Over HTTP/1.1 (a local container,
 * the dev server) the browser opens six connections per host, and a lesson's request
 * holds one for minutes; four leave room for the editor's own requests.
 */
export const LIMITED_CONCURRENCY = 4;

/** `nextHopProtocol` of the page's navigation entry (`h2`, `h3`, `http/1.1`, ...), if known. */
export function concurrencyFor(protocol: string | undefined): number {
	return protocol === 'h2' || protocol === 'h3' ? Number.POSITIVE_INFINITY : LIMITED_CONCURRENCY;
}
