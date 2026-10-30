import {isNonPublicIp} from './non-public-ip';

describe('isNonPublicIp', () => {
	it.each([
		'10.1.2.3',
		'172.16.0.1',
		'172.31.255.254',
		'192.168.1.1',
		'100.64.0.1',
		'100.127.255.254',
		'169.254.10.20',
		'0.0.0.0',
		'::ffff:172.21.0.1',
		'::ffff:100.100.1.1',
		'::',
		'fd7a:115c:a1e0::1',
		'fe80::1',
	])('treats %s as non-public', (ip) => {
		expect(isNonPublicIp(ip)).toBe(true);
	});

	it.each([
		'203.0.113.10',
		'198.51.100.7',
		'172.32.0.1',
		'100.128.0.1',
		'2001:db8::1',
		'::ffff:203.0.113.10',
		'not-an-ip',
	])('treats %s as public', (ip) => {
		expect(isNonPublicIp(ip)).toBe(false);
	});
});
