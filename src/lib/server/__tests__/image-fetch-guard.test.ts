import { describe, expect, it, vi } from 'vitest';
import {
	MAX_BODY_BYTES,
	MAX_REDIRECTS,
	UnsafeUrlError,
	assertPublicHost,
	assertSafeUrl,
	fetchImageSafely,
	isAllowedImageContentType,
	isAllowedScheme,
	isReservedAddress,
	isReservedIPv4,
	isReservedIPv6
} from '../image-fetch-guard';

describe('isAllowedScheme', () => {
	it('allows http and https', () => {
		expect(isAllowedScheme(new URL('http://example.com/x.png'))).toBe(true);
		expect(isAllowedScheme(new URL('https://example.com/x.png'))).toBe(true);
	});

	it('rejects everything else a teacher could paste', () => {
		expect(isAllowedScheme(new URL('file:///etc/passwd'))).toBe(false);
		expect(isAllowedScheme(new URL('data:image/png;base64,AAAA'))).toBe(false);
		expect(isAllowedScheme(new URL('ftp://example.com/x.png'))).toBe(false);
	});
});

describe('isReservedIPv4', () => {
	it('flags loopback, link-local, RFC1918, and cloud metadata', () => {
		expect(isReservedIPv4('127.0.0.1')).toBe(true);
		expect(isReservedIPv4('10.0.0.5')).toBe(true);
		expect(isReservedIPv4('172.16.0.1')).toBe(true);
		expect(isReservedIPv4('172.31.255.255')).toBe(true);
		expect(isReservedIPv4('192.168.1.1')).toBe(true);
		expect(isReservedIPv4('169.254.169.254')).toBe(true); // cloud metadata endpoint
		expect(isReservedIPv4('0.0.0.0')).toBe(true);
		expect(isReservedIPv4('240.0.0.1')).toBe(true);
	});

	it('does not flag public addresses, including the edges of private ranges', () => {
		expect(isReservedIPv4('8.8.8.8')).toBe(false);
		expect(isReservedIPv4('93.184.216.34')).toBe(false);
		expect(isReservedIPv4('172.15.255.255')).toBe(false); // just below 172.16/12
		expect(isReservedIPv4('172.32.0.0')).toBe(false); // just above 172.16/12
	});
});

describe('isReservedIPv6', () => {
	it('flags loopback, unspecified, link-local, and unique-local', () => {
		expect(isReservedIPv6('::1')).toBe(true);
		expect(isReservedIPv6('::')).toBe(true);
		expect(isReservedIPv6('fe80::1')).toBe(true);
		expect(isReservedIPv6('fc00::1')).toBe(true);
		expect(isReservedIPv6('fd12:3456::1')).toBe(true);
	});

	it('unwraps IPv4-mapped addresses and checks the embedded address', () => {
		expect(isReservedIPv6('::ffff:127.0.0.1')).toBe(true);
		expect(isReservedIPv6('::ffff:8.8.8.8')).toBe(false);
	});

	it('does not flag a public IPv6 address', () => {
		expect(isReservedIPv6('2001:4860:4860::8888')).toBe(false);
	});
});

describe('isReservedAddress', () => {
	it('dispatches to the IPv4 or IPv6 check', () => {
		expect(isReservedAddress('127.0.0.1')).toBe(true);
		expect(isReservedAddress('8.8.8.8')).toBe(false);
		expect(isReservedAddress('::1')).toBe(true);
		expect(isReservedAddress('2001:4860:4860::8888')).toBe(false);
	});

	it('treats a non-IP string as unsafe rather than silently passing it', () => {
		expect(isReservedAddress('not-an-ip')).toBe(true);
	});
});

describe('assertPublicHost', () => {
	it('rejects a hostname that resolves only to a private address, without needing DNS for a literal', async () => {
		const lookup = vi.fn();
		await expect(assertPublicHost('127.0.0.1', lookup)).rejects.toThrow(UnsafeUrlError);
		expect(lookup).not.toHaveBeenCalled();
	});

	it('resolves a hostname and rejects it if any answer is reserved, even if others are public', async () => {
		const lookup = vi.fn().mockResolvedValue([
			{ address: '93.184.216.34', family: 4 },
			{ address: '10.0.0.1', family: 4 }
		]);
		await expect(assertPublicHost('sneaky.example', lookup)).rejects.toThrow(UnsafeUrlError);
	});

	it('accepts a hostname whose every answer is public', async () => {
		const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
		await expect(assertPublicHost('example.com', lookup)).resolves.toBeUndefined();
	});

	it('treats a DNS failure as unsafe rather than letting fetch find out', async () => {
		const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
		await expect(assertPublicHost('nowhere.invalid', lookup)).rejects.toThrow(UnsafeUrlError);
	});
});

describe('assertSafeUrl', () => {
	it('rejects a disallowed scheme before ever resolving the host', async () => {
		const lookup = vi.fn();
		await expect(assertSafeUrl(new URL('file:///etc/passwd'), lookup)).rejects.toThrow(UnsafeUrlError);
		expect(lookup).not.toHaveBeenCalled();
	});
});

describe('isAllowedImageContentType', () => {
	it('accepts any image/* type, including svg and one with parameters', () => {
		expect(isAllowedImageContentType('image/png')).toBe(true);
		expect(isAllowedImageContentType('image/svg+xml')).toBe(true);
		expect(isAllowedImageContentType('image/jpeg; charset=binary')).toBe(true);
	});

	it('rejects non-image types and missing headers', () => {
		expect(isAllowedImageContentType('text/html')).toBe(false);
		expect(isAllowedImageContentType('application/json')).toBe(false);
		expect(isAllowedImageContentType(null)).toBe(false);
		expect(isAllowedImageContentType(undefined)).toBe(false);
	});
});

describe('fetchImageSafely', () => {
	const publicLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

	it('returns the response when the address and content-type are fine', async () => {
		const body = new TextEncoder().encode('fake-png-bytes');
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(body, { status: 200, headers: { 'content-type': 'image/png' } })
		);

		const result = await fetchImageSafely('https://example.com/x.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		const bytes = new Uint8Array(await result.response!.arrayBuffer());
		expect(new TextDecoder().decode(bytes)).toBe('fake-png-bytes');
	});

	it('never calls fetch for a URL whose host is private', async () => {
		const lookup = vi.fn().mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
		const fetchFn = vi.fn();

		const result = await fetchImageSafely('http://internal.example/secret.png', { lookup, fetchFn });

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/reserved/i);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('follows a redirect and re-checks the target host', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: 'https://cdn.example/x.png' } })
			)
			.mockResolvedValueOnce(
				new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } })
			);

		const result = await fetchImageSafely('https://example.com/x.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('rejects a redirect whose target resolves to a private address', async () => {
		const lookup = vi
			.fn()
			.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
			.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(null, { status: 302, headers: { location: 'https://internal.example/x.png' } })
			);

		const result = await fetchImageSafely('https://example.com/x.png', { lookup, fetchFn });

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/reserved/i);
		// The second hop was never actually connected to.
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('gives up after too many redirects', async () => {
		const fetchFn = vi.fn().mockImplementation(
			async () => new Response(null, { status: 302, headers: { location: 'https://example.com/next' } })
		);

		const result = await fetchImageSafely('https://example.com/x.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/redirect/i);
		expect(fetchFn).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
	});

	it('rejects a non-image content-type', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await fetchImageSafely('https://example.com/x.json', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/content-type/i);
	});

	it('rejects a declared content-length over the cap without reading the body', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(new Uint8Array(1), {
				status: 200,
				headers: { 'content-type': 'image/png', 'content-length': String(MAX_BODY_BYTES + 1) }
			})
		);

		const result = await fetchImageSafely('https://example.com/huge.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/exceeds/i);
	});

	it('cuts off a body that exceeds the cap even without a content-length header', async () => {
		const oversized = new Uint8Array(MAX_BODY_BYTES + 1024);
		const fetchFn = vi
			.fn()
			.mockResolvedValue(new Response(oversized, { status: 200, headers: { 'content-type': 'image/png' } }));

		const result = await fetchImageSafely('https://example.com/huge.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(true);
		await expect(result.response!.arrayBuffer()).rejects.toThrow(/exceeded/i);
	});

	it('treats a network error as a failed attempt rather than throwing', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

		const result = await fetchImageSafely('https://example.com/x.png', {
			lookup: publicLookup,
			fetchFn
		});

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/network error/i);
	});

	it('rejects an unparsable URL up front', async () => {
		const fetchFn = vi.fn();
		const result = await fetchImageSafely('not a url', { lookup: publicLookup, fetchFn });
		expect(result.ok).toBe(false);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
