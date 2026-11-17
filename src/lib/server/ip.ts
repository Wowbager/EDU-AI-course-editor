/**
 * IP addresses as the server's limits and its fetch guard need them.
 */
import { isIP } from 'node:net';

/** The eight 16-bit groups of an IPv6 address, or `null` when it is not one. */
export function ipv6Groups(address: string): number[] | null {
	let text = address.toLowerCase().replace(/^\[|\]$/g, '');
	const zone = text.indexOf('%');
	if (zone !== -1) text = text.slice(0, zone);
	if (isIP(text) !== 6) return null;
	// A trailing dotted IPv4 (`::ffff:1.2.3.4`) is two groups.
	const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
	if (dotted) {
		const [a, b, c, d] = dotted[2].split('.').map(Number);
		text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const [head, tail] = text.split('::');
	const left = head === '' ? [] : head.split(':');
	const right = tail === undefined || tail === '' ? [] : tail.split(':');
	const fill = tail === undefined ? 0 : 8 - left.length - right.length;
	const groups = [...left, ...Array<string>(fill).fill('0'), ...right].map((g) => parseInt(g, 16));
	return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The IPv4 address an IPv6 one carries, when it is IPv4-mapped (`::ffff:a.b.c.d`),
 * IPv4-compatible (`::a.b.c.d`) or NAT64 (`64:ff9b::a.b.c.d`), in any spelling.
 */
export function embeddedIPv4(groups: readonly number[]): string | null {
	const zeros = (from: number, to: number) => groups.slice(from, to).every((g) => g === 0);
	const mapped = zeros(0, 5) && (groups[5] === 0xffff || (groups[5] === 0 && groups[6] !== 0));
	const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6);
	if (!mapped && !nat64) return null;
	const [hi, lo] = [groups[6], groups[7]];
	return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Who a request comes from, for a limit: an IPv4 address as it is, an IPv6 one by its
 * /64 (one household or school gets a whole /64), unknown as `unknown`.
 */
export function clientKey(address: string): string {
	const text = address.trim();
	if (isIP(text) === 4) return text;
	const groups = ipv6Groups(text);
	if (groups === null) return 'unknown';
	const v4 = embeddedIPv4(groups);
	if (v4 !== null) return v4;
	return `${groups
		.slice(0, 4)
		.map((g) => g.toString(16))
		.join(':')}::/64`;
}

let warned = false;

/**
 * The request's client, by `clientKey`; `unknown` where the platform cannot say, which
 * puts every such request in one bucket of the limits. Behind nginx that means a request
 * reached the editor without `X-Editor-Client` (`ADDRESS_HEADER`): said once in the log.
 */
export function clientOf(event: { getClientAddress(): string }): string {
	try {
		return clientKey(event.getClientAddress());
	} catch (e) {
		if (!warned) {
			warned = true;
			console.warn('[limits] no client address; such requests share one limit:', String(e));
		}
		return 'unknown';
	}
}
