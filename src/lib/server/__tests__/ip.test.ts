import { describe, expect, it } from 'vitest';
import { clientKey, clientOf, embeddedIPv4, ipv6Groups } from '../ip';

describe('clientKey', () => {
	it('keeps an IPv4 address and unwraps one mapped into IPv6', () => {
		expect(clientKey('203.0.113.5')).toBe('203.0.113.5');
		expect(clientKey('::ffff:203.0.113.5')).toBe('203.0.113.5');
		expect(clientKey('::ffff:cb00:7105')).toBe('203.0.113.5');
	});

	it('takes an IPv6 address by its /64, so one machine cannot rotate through it', () => {
		expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
		expect(clientKey('2001:db8:1:2:bbbb::9')).toBe('2001:db8:1:2::/64');
	});

	it('says unknown for what is not an address', () => {
		expect(clientKey('')).toBe('unknown');
		expect(clientKey('nonsense')).toBe('unknown');
		expect(
			clientOf({
				getClientAddress: () => {
					throw new Error('no address');
				}
			})
		).toBe('unknown');
	});
});

describe('ipv6Groups and embeddedIPv4', () => {
	it('reads every spelling of a mapped, compatible or NAT64 address', () => {
		expect(embeddedIPv4(ipv6Groups('::ffff:127.0.0.1')!)).toBe('127.0.0.1');
		expect(embeddedIPv4(ipv6Groups('::ffff:7f00:1')!)).toBe('127.0.0.1');
		expect(embeddedIPv4(ipv6Groups('0:0:0:0:0:ffff:7f00:0001')!)).toBe('127.0.0.1');
		expect(embeddedIPv4(ipv6Groups('64:ff9b::10.0.0.1')!)).toBe('10.0.0.1');
		expect(embeddedIPv4(ipv6Groups('::a00:1')!)).toBe('10.0.0.1');
		expect(embeddedIPv4(ipv6Groups('2001:db8::1')!)).toBeNull();
		expect(ipv6Groups('[::1]')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
		expect(ipv6Groups('1.2.3.4')).toBeNull();
	});
});
