import {createWebUrl} from './web-url';

describe('createWebUrl', () => {
	it('resolves application paths below a mounted base path', () => {
		expect(createWebUrl('/accounts', 'https://example.ts.net/tempo')).toBe(
			'https://example.ts.net/tempo/accounts',
		);
	});

	it('resolves application paths from a root base URL', () => {
		expect(createWebUrl('/accounts', 'http://localhost:5173')).toBe(
			'http://localhost:5173/accounts',
		);
	});

	it('encodes query parameters on application URLs', () => {
		expect(
			createWebUrl('/verify-email', 'https://example.ts.net/tempo', {
				email: 'user+test@example.com',
				code: 'a/b',
			}),
		).toBe('https://example.ts.net/tempo/verify-email?email=user%2Btest%40example.com&code=a%2Fb');
	});
});
