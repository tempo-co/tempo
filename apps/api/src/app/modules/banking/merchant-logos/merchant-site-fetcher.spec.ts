import {LookupAddress} from 'node:dns';
import {EventEmitter} from 'node:events';
import {IncomingHttpHeaders, IncomingMessage} from 'node:http';
import {RequestOptions, request} from 'node:https';
import {Readable} from 'node:stream';
import {gzipSync} from 'node:zlib';

import {MerchantSiteFetcher} from './merchant-site-fetcher';

type Reply = {
	status?: number;
	headers?: IncomingHttpHeaders;
	body?: Buffer[];
	/** Never answers, or answers and then sends no more of the body. */
	stall?: 'headers' | 'body';
	/** Destroying the response never completes, like a response whose socket already closed. */
	wedged?: boolean;
};

/** A fake DNS and HTTPS transport that records requests; URL and address checks stay real. */
function network(replies: Reply[] = [{}], addresses: LookupAddress[] = [{address: '93.184.215.14', family: 4}]) {
	const lookup = jest.fn(async () => addresses);
	const requests: RequestOptions[] = [];
	const send = jest.fn((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
		const reply = replies[requests.push(options) - 1] ?? {};
		const req = new EventEmitter() as EventEmitter & {end: () => void};
		options.signal?.addEventListener('abort', () => req.emit('error', new Error('aborted')));
		req.end = () => {
			if (reply.stall === 'headers') return;
			queueMicrotask(() => {
				const response = (
					reply.stall === 'body'
						? new Readable({read() {}}).once('resume', function (this: Readable) {
								this.push('<html>');
							})
						: Readable.from(reply.body ?? [Buffer.from('icon')])
				) as IncomingMessage;
				if (reply.wedged) response._destroy = () => {};
				response.statusCode = reply.status ?? 200;
				response.headers = reply.headers ?? {'content-type': 'image/png'};
				callback(response);
			});
		};
		return req;
	});
	return {lookup, request: send as unknown as typeof request, send, requests};
}

const fetchOptions = {accept: 'image/*', maxBytes: 1024};

describe('MerchantSiteFetcher', () => {
	it('fetches over HTTPS from the checked address with certificate checks and no cookies', async () => {
		const fake = network([{}], [{address: '2606:4700:4700::1111', family: 6}]);
		const result = await new MerchantSiteFetcher(fake).fetch('https://shop.example.test/icon.png', fetchOptions);
		expect(result).toEqual({
			bytes: Buffer.from('icon'),
			url: 'https://shop.example.test/icon.png',
		});
		expect(fake.requests[0]).toMatchObject({
			hostname: 'shop.example.test',
			servername: 'shop.example.test',
			port: 443,
			agent: false,
			rejectUnauthorized: true,
		});
		expect(Object.keys(fake.requests[0].headers ?? {})).toEqual(['Accept', 'Accept-Encoding', 'User-Agent']);
		const callback = jest.fn();
		fake.requests[0].lookup!('shop.example.test', {}, callback);
		expect(callback).toHaveBeenCalledWith(null, '2606:4700:4700::1111', 6);
		expect(fake.lookup).toHaveBeenCalledTimes(1);
	});

	it('follows a redirect to another public HTTPS host after checking its addresses again', async () => {
		const fake = network([
			{status: 301, headers: {location: 'https://www.shop.example.test/'}},
			{status: 302, headers: {location: '/home'}},
			{body: [Buffer.from('page')]},
		]);
		const result = await new MerchantSiteFetcher(fake).fetch('https://shop.example.test/', fetchOptions);
		expect(result.url).toBe('https://www.shop.example.test/home');
		expect(fake.lookup.mock.calls).toEqual([
			['shop.example.test'],
			['www.shop.example.test'],
			['www.shop.example.test'],
		]);
	});

	it.each([
		'http://shop.example.test/',
		'https://shop.example.test:8443/',
		'https://user:pass@shop.example.test/',
		'https://127.0.0.1/',
		'https://[::1]/',
		'file:///etc/passwd',
		'https://shop.example.test/\nicon',
	])('refuses %j before any DNS or HTTP', async (url) => {
		const fake = network();
		await expect(new MerchantSiteFetcher(fake).fetch(url, fetchOptions)).rejects.toMatchObject({
			code: 'unsafe_url',
		});
		expect(fake.lookup).not.toHaveBeenCalled();
		expect(fake.send).not.toHaveBeenCalled();
	});

	it('follows a redirect to plain HTTP over HTTPS, and refuses one to another port', async () => {
		const fake = network([{status: 302, headers: {location: 'http://shop.example.test:80/home'}}, {}]);
		const result = await new MerchantSiteFetcher(fake).fetch('https://shop.example.test/', fetchOptions);
		expect(result.url).toBe('https://shop.example.test/home');
		expect(fake.requests[1]).toMatchObject({port: 443, path: '/home'});

		const other = network([{status: 302, headers: {location: 'http://shop.example.test:8080/'}}]);
		await expect(
			new MerchantSiteFetcher(other).fetch('https://shop.example.test/', fetchOptions),
		).rejects.toMatchObject({code: 'unsafe_url'});
		expect(other.send).toHaveBeenCalledTimes(1);
	});

	it('bounds redirect chains', async () => {
		const fake = network(Array.from({length: 6}, () => ({status: 302, headers: {location: '/loop'}})));
		await expect(
			new MerchantSiteFetcher(fake).fetch('https://shop.example.test/', fetchOptions),
		).rejects.toMatchObject({code: 'limit'});
		expect(fake.send).toHaveBeenCalledTimes(4);
	});

	it.each([
		'127.0.0.1',
		'10.0.0.1',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'0.0.0.0',
		'::1',
		'fc00::1',
		'fe80::1',
		'fec0::1',
		'64:ff9b:1::a00:1',
		'::ffff:127.0.0.1',
	])('refuses a host when any of its addresses is %s', async (address) => {
		const fake = network(
			[{}],
			[
				{address: '93.184.215.14', family: 4},
				{address, family: address.includes(':') ? 6 : 4},
			],
		);
		await expect(
			new MerchantSiteFetcher(fake).fetch('https://shop.example.test/', fetchOptions),
		).rejects.toMatchObject({code: 'unsafe_address'});
		expect(fake.send).not.toHaveBeenCalled();
	});

	it('decompresses a page and keeps only its beginning when truncation is allowed', async () => {
		const page = Buffer.from(`<title>Example Shop</title>${'x'.repeat(5000)}`);
		// The beginning is returned without waiting for the rest of the response to tear down.
		const fake = network([{headers: {'content-encoding': 'gzip'}, body: [gzipSync(page)], wedged: true}]);
		const result = await new MerchantSiteFetcher(fake).fetch('https://shop.example.test/', {
			accept: 'text/html',
			maxBytes: 100,
			truncate: true,
		});
		expect(result.bytes.toString()).toBe(page.subarray(0, 100).toString());
	});

	it.each([
		['an oversized body', {body: [Buffer.alloc(2000)]}, 'limit'],
		[
			'a compressed body that expands past the limit',
			{headers: {'content-encoding': 'gzip'}, body: [gzipSync(Buffer.alloc(100_000))]},
			'limit',
		],
		['an unknown encoding', {headers: {'content-encoding': 'zstd'}}, 'fetch_failed'],
		['a 404', {status: 404}, 'fetch_failed'],
	])('rejects %s', async (_, reply, code) => {
		await expect(
			new MerchantSiteFetcher(network([reply as Reply])).fetch('https://shop.example.test/', fetchOptions),
		).rejects.toMatchObject({code});
	});

	it.each([
		['before answering', 'headers'],
		['in the middle of its body, after its connection closed', 'body'],
	] as const)('gives up on a server that stalls %s when the caller aborts', async (_, stall) => {
		const controller = new AbortController();
		const result = new MerchantSiteFetcher(network([{stall, wedged: true}]))
			.fetch('https://shop.example.test/', {...fetchOptions, signal: controller.signal})
			.catch((error: unknown) => error);
		await new Promise((resolve) => setImmediate(resolve));
		controller.abort();
		await expect(result).resolves.toMatchObject({code: 'limit'});
	});
});
