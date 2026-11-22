import {toMerchantDomain} from './merchant-domain';

describe('toMerchantDomain', () => {
	it.each([
		['example.com', 'example.com'],
		['example.co.uk', 'example.co.uk'],
		['shop.example.co.uk', 'shop.example.co.uk'],
		['boutique.example.com', 'boutique.example.com'],
		['shop.example.github.io', 'shop.example.github.io'],
		[`${'a'.repeat(52)}.com`, `${'a'.repeat(52)}.com`],
	])('keeps a registrable domain or one short label below it: %s', (domain, expected) => {
		expect(toMerchantDomain(domain)).toBe(expected);
	});

	it.each([
		[null],
		[''],
		['co.uk'],
		['com'],
		['www.example.com'],
		['a.b.example.com'],
		['boutiques.example.com'],
		['shopa-shopb.attacker.example'],
		[`${'a'.repeat(61)}.com`],
		['Example.com'],
		['example.com.'],
		['192.0.2.1'],
	])('rejects %s', (domain) => {
		expect(toMerchantDomain(domain)).toBeNull();
	});
});
