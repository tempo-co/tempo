import {toLogoDevResult} from './logo-dev.client';

const found = (source: Record<string, unknown>) => ({
	data: {url: 'https://img.logo.dev/assets/example-asset?signature=abc', source},
});

describe('toLogoDevResult', () => {
	it('asks for a PNG download and rates it by the original it was made from', () => {
		const raster = toLogoDevResult(200, found({width: 400, height: 300, format: 'jpg', is_vector: false}));
		expect(raster).toEqual({status: 'found', url: expect.any(String), size: 300});
		const url = new URL((raster as {url: string}).url);
		expect(url.origin + url.pathname).toBe('https://img.logo.dev/assets/example-asset');
		expect(Object.fromEntries(url.searchParams)).toEqual({signature: 'abc', format: 'png', size: '256'});

		// A vector is sharp at any size, whatever its coordinate size.
		expect(toLogoDevResult(200, found({width: 24, height: 24, format: 'svg', is_vector: true}))).toMatchObject({
			status: 'found',
			size: 512,
		});
		expect(toLogoDevResult(200, found({width: 16, height: 16, format: 'ico', is_vector: false}))).toMatchObject({
			size: 16,
		});
	});

	it('reports no logo for an unknown domain or an answer without one, and asks again later otherwise', () => {
		expect(toLogoDevResult(404, null)).toEqual({status: 'none'});
		expect(toLogoDevResult(200, {data: {status: 'ready'}})).toEqual({status: 'none'});
		expect(toLogoDevResult(200, {data: {url: 'not a url', source: {width: 64, height: 64}}})).toEqual({
			status: 'none',
		});
		// Still indexing, out of credits, rate limited or failing.
		for (const status of [202, 402, 429, 500]) expect(toLogoDevResult(status, null)).toEqual({status: 'later'});
	});
});
