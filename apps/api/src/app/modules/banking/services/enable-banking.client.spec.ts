import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {ConfigurationService} from '@core/config/config.service';

import {EnableBankingClient} from './enable-banking.client';

describe('EnableBankingClient', () => {
	let client: EnableBankingClient;
	let fetchMock: jest.SpyInstance;

	beforeEach(() => {
		const values: Record<string, string> = {
			ENABLE_BANKING_API_URL: 'https://api.example.test',
			ENABLE_BANKING_APPLICATION_ID: 'application-id',
			ENABLE_BANKING_PRIVATE_KEY_B64: Buffer.from('test-key').toString('base64'),
		};
		const config = {
			get: (key: string) => values[key],
		} as unknown as ConfigurationService;
		client = new EnableBankingClient(config);
		jest.spyOn(client as unknown as {createJwt: () => string}, 'createJwt').mockReturnValue('test.jwt');
		fetchMock = jest.spyOn(globalThis, 'fetch');
	});

	it('does not initialize or call the provider when banking integration is disabled', async () => {
		const values: Record<string, string | boolean | undefined> = {
			BANKING_INTEGRATION_ENABLED: false,
			ENABLE_BANKING_API_URL: 'https://disabled.invalid',
			ENABLE_BANKING_APPLICATION_ID: 'disabled',
		};
		const disabledConfig = {
			get: (key: string) => values[key],
		} as unknown as ConfigurationService;

		expect(() => new EnableBankingClient(disabledConfig)).not.toThrow();
		const disabledClient = new EnableBankingClient(disabledConfig);

		await expect(disabledClient.getAspsps()).rejects.toMatchObject({code: 'banking_integration_disabled'});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	afterEach(() => {
		fetchMock.mockRestore();
	});

	it('does not load the provider private key when banking integration is disabled', () => {
		const config = {
			get: (key: string) => {
				if (key === 'BANKING_INTEGRATION_ENABLED') return false;
				if (key === 'ENABLE_BANKING_PRIVATE_KEY_PATH' || key === 'ENABLE_BANKING_PRIVATE_KEY_B64') {
					throw new Error('provider private key must not be read');
				}
				return {
					ENABLE_BANKING_API_URL: 'https://api.example.test',
					ENABLE_BANKING_APPLICATION_ID: 'application-id',
				}[key];
			},
		} as unknown as ConfigurationService;

		expect(() => new EnableBankingClient(config)).not.toThrow();
	});

	it('reuses a JWT while it remains valid', () => {
		const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
		const values: Record<string, string> = {
			ENABLE_BANKING_API_URL: 'https://api.example.test',
			ENABLE_BANKING_APPLICATION_ID: 'application-id',
			ENABLE_BANKING_PRIVATE_KEY_B64: Buffer.from(
				privateKey.export({type: 'pkcs8', format: 'pem'}).toString(),
			).toString('base64'),
		};
		const config = {
			get: (key: string) => values[key],
		} as unknown as ConfigurationService;
		const jwtClient = new EnableBankingClient(config);
		const createJwt = (jwtClient as unknown as {createJwt: () => string}).createJwt.bind(jwtClient);
		const now = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		try {
			const firstToken = createJwt();
			now.mockReturnValue(1_700_000_001_000);

			expect(createJwt()).toBe(firstToken);
		} finally {
			now.mockRestore();
		}
	});

	it('loads the signing key from a configured file path', () => {
		const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
		const directory = mkdtempSync(join(tmpdir(), 'tempo-enable-banking-'));
		const privateKeyPath = join(directory, 'private.key');
		writeFileSync(privateKeyPath, privateKey.export({type: 'pkcs8', format: 'pem'}));

		const values: Record<string, string | undefined> = {
			ENABLE_BANKING_API_URL: 'https://api.example.test',
			ENABLE_BANKING_APPLICATION_ID: 'application-id',
			ENABLE_BANKING_PRIVATE_KEY_PATH: privateKeyPath,
		};
		const config = {
			get: (key: string) => values[key],
		} as unknown as ConfigurationService;
		const jwtClient = new EnableBankingClient(config);
		const createJwt = (jwtClient as unknown as {createJwt: () => string}).createJwt.bind(jwtClient);

		try {
			expect(createJwt().split('.')).toHaveLength(3);
		} finally {
			rmSync(directory, {recursive: true, force: true});
		}
	});

	it('starts authorization with the required provider access and redirect details', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({url: 'https://auth.example.test/start', authorization_id: 'authorization-id'}),
				{
					status: 200,
					headers: {'content-type': 'application/json'},
				},
			),
		);

		await expect(
			client.startAuthorization({
				state: 'state-value',
				redirectUrl: 'https://app.example.test/bank-connections/callback',
				psuId: 'psu-id',
				aspsp: {name: 'Nordea', country: 'FI'},
				validUntil: '2030-01-01T00:00:00.000Z',
			}),
		).resolves.toEqual({url: 'https://auth.example.test/start', authorizationId: 'authorization-id'});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
		expect(requestUrl.pathname).toBe('/auth');
		expect(requestInit.method).toBe('POST');
		expect(requestInit.headers).toEqual(
			expect.objectContaining({
				Accept: 'application/json',
				'Content-Type': 'application/json',
				Authorization: 'Bearer test.jwt',
			}),
		);
		expect(JSON.parse(String(requestInit.body))).toEqual({
			access: {balances: true, transactions: true, valid_until: '2030-01-01T00:00:00.000Z'},
			aspsp: {name: 'Nordea', country: 'FI'},
			state: 'state-value',
			redirect_url: 'https://app.example.test/bank-connections/callback',
			psu_type: 'personal',
			psu_id: 'psu-id',
		});
	});

	it('maps an authorization session and its provider accounts', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					session_id: 'session-id',
					access: {valid_until: '2030-01-01T00:00:00.000Z'},
					aspsp: {name: 'Nordea', country: 'FI'},
					accounts: [
						{
							uid: 'account-id',
							identification_hash: 'account-hash',
							name: 'Main account',
							details: 'Everyday spending',
							currency: 'EUR',
							cash_account_type: 'CACC',
							usage: 'PRIV',
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.createSession('provider-code')).resolves.toEqual({
			sessionId: 'session-id',
			consentValidUntil: '2030-01-01T00:00:00.000Z',
			aspsp: {name: 'Nordea', country: 'FI'},
			accounts: [
				{
					uid: 'account-id',
					identificationHash: 'account-hash',
					name: 'Main account',
					details: 'Everyday spending',
					currency: 'EUR',
					cashAccountType: 'CACC',
					usage: 'PRIV',
				},
			],
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
		expect(requestUrl.pathname).toBe('/sessions');
		expect(requestInit.method).toBe('POST');
		expect(JSON.parse(String(requestInit.body))).toEqual({code: 'provider-code'});
	});

	it.each([
		{name: 'a valid account IBAN', accountId: {iban: 'nl91 abna 0417 1643 00'}, expected: 'NL91ABNA0417164300'},
		{name: 'an invalid account IBAN', accountId: {iban: 'NL91ABNA0417164301'}, expected: undefined},
		{name: 'a missing account identifier', accountId: undefined, expected: undefined},
	])('maps $name from the session account', async ({accountId, expected}) => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					session_id: 'session-id',
					access: {valid_until: '2030-01-01T00:00:00.000Z'},
					aspsp: {name: 'Example Bank', country: 'NL'},
					accounts: [
						{
							uid: 'account-id',
							identification_hash: 'account-hash',
							currency: 'EUR',
							account_id: accountId,
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		const session = await client.createSession('provider-code');

		expect(session.accounts[0].iban).toBe(expected);
	});

	it('requests ASPSPs for personal account-information access', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					aspsps: [
						{
							name: 'Nordea',
							country: 'FI',
							logo: 'https://enablebanking.com/brands/FI/Nordea/',
							maximum_consent_validity: 86_400,
							required_psu_headers: ['Psu-Ip-Address', 'Psu-User-Agent'],
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.getAspsps('FI')).resolves.toEqual([
			{
				name: 'Nordea',
				country: 'FI',
				logoUrl: 'https://enablebanking.com/brands/FI/Nordea/',
				maximumConsentValiditySeconds: 86_400,
				requiredPsuHeaders: ['Psu-Ip-Address', 'Psu-User-Agent'],
			},
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(requestUrl.pathname).toBe('/aspsps');
		expect(requestUrl.searchParams.get('country')).toBe('FI');
		expect(requestUrl.searchParams.get('psu_type')).toBe('personal');
		expect(requestUrl.searchParams.get('service')).toBe('AIS');
	});

	it.each(['Psu-Ip-Address', [null], [''], ['   ']])(
		'rejects malformed required PSU header metadata %j',
		async (requiredPsuHeaders) => {
			fetchMock.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						aspsps: [
							{
								name: 'Example Bank',
								country: 'FI',
								maximum_consent_validity: 86_400,
								required_psu_headers: requiredPsuHeaders,
							},
						],
					}),
					{status: 200},
				),
			);
			await expect(client.getAspsps('FI')).rejects.toMatchObject({code: 'invalid_provider_response'});
		},
	);

	it('requests the full supported ASPSP catalog without a country filter', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					aspsps: [
						{name: 'ABN AMRO', country: 'NL', maximum_consent_validity: 86_400},
						{name: 'Revolut', country: 'NL', maximum_consent_validity: 86_400},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.getAspsps()).resolves.toEqual([
			{name: 'ABN AMRO', country: 'NL', maximumConsentValiditySeconds: 86_400},
			{name: 'Revolut', country: 'NL', maximumConsentValiditySeconds: 86_400},
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(requestUrl.pathname).toBe('/aspsps');
		expect(requestUrl.searchParams.has('country')).toBe(false);
		expect(requestUrl.searchParams.get('psu_type')).toBe('personal');
		expect(requestUrl.searchParams.get('service')).toBe('AIS');
	});

	it('falls back to country-only discovery when a provider does not support filters', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({error: 'WRONG_REQUEST_PARAMETERS'}), {
					status: 400,
					headers: {'content-type': 'application/json'},
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						aspsps: [{name: 'Nordea', country: 'FI', maximum_consent_validity: 86_400}],
					}),
					{status: 200, headers: {'content-type': 'application/json'}},
				),
			);

		await expect(client.getAspsps('FI')).resolves.toEqual([
			{name: 'Nordea', country: 'FI', maximumConsentValiditySeconds: 86_400},
		]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const filteredUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(filteredUrl.searchParams.get('country')).toBe('FI');
		expect(filteredUrl.searchParams.get('psu_type')).toBe('personal');
		expect(filteredUrl.searchParams.get('service')).toBe('AIS');

		const fallbackUrl = new URL(String(fetchMock.mock.calls[1][0]));
		expect(fallbackUrl.pathname).toBe('/aspsps');
		expect(fallbackUrl.searchParams.get('country')).toBe('FI');
		expect(fallbackUrl.searchParams.has('psu_type')).toBe(false);
		expect(fallbackUrl.searchParams.has('service')).toBe(false);
	});

	it('does not fall back for non-filter provider errors', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({error: 'provider_unavailable'}), {
				status: 503,
				headers: {'content-type': 'application/json'},
			}),
		);

		await expect(client.getAspsps('FI')).rejects.toMatchObject({
			code: 'provider_unavailable',
			providerStatus: 503,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not fall back for unrelated client errors', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({error: 'invalid_country'}), {
				status: 400,
				headers: {'content-type': 'application/json'},
			}),
		);

		await expect(client.getAspsps('FI')).rejects.toMatchObject({
			code: 'invalid_country',
			providerStatus: 400,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('captures the provider retry delay for rate-limited responses', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({error: 'ASPSP_RATE_LIMIT_EXCEEDED'}), {
				status: 429,
				headers: {'content-type': 'application/json', 'retry-after': '17'},
			}),
		);

		await expect(client.getAccountBalances('account-id')).rejects.toMatchObject({
			code: 'ASPSP_RATE_LIMIT_EXCEEDED',
			providerStatus: 429,
			retryAfterSeconds: 17,
		});
	});

	it('captures Retry-After for a non-429 rate-limit response', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({error: 'ASPSP_RATE_LIMIT_EXCEEDED'}), {
				status: 400,
				headers: {'content-type': 'application/json', 'retry-after': '23'},
			}),
		);

		await expect(client.getAccountBalances('account-id')).rejects.toMatchObject({
			code: 'ASPSP_RATE_LIMIT_EXCEEDED',
			providerStatus: 400,
			retryAfterSeconds: 23,
		});
	});

	it('ignores an unsafe numeric Retry-After value', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({error: 'ASPSP_RATE_LIMIT_EXCEEDED'}), {
				status: 400,
				headers: {'content-type': 'application/json', 'retry-after': '999999999999999999999999'},
			}),
		);

		await expect(client.getAccountBalances('account-id')).rejects.toMatchObject({
			code: 'ASPSP_RATE_LIMIT_EXCEEDED',
			retryAfterSeconds: undefined,
		});
	});
	it('propagates an error from the country-only fallback', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({error: 'WRONG_REQUEST_PARAMETERS'}), {
					status: 422,
					headers: {'content-type': 'application/json'},
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({error: 'provider_unavailable'}), {
					status: 503,
					headers: {'content-type': 'application/json'},
				}),
			);

		await expect(client.getAspsps('FI')).rejects.toMatchObject({
			code: 'provider_unavailable',
			providerStatus: 503,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('maps the authoritative account IDs from a session response', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					status: 'AUTHORIZED',
					accounts: ['account-1', 'account-2'],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.getSessionAccounts('session-id')).resolves.toEqual({
			status: 'AUTHORIZED',
			accountIds: ['account-1', 'account-2'],
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(requestUrl.pathname).toBe('/sessions/session-id');
	});

	it.each([
		['umlaut', 'S\u00fcdbahnhof Store'],
		['acute accent', 'Caf\u00e9 Central'],
		['circumflex', 'Cr\u00eaperie Belle'],
		['capital diacritic start', '\u00cele River Transit'],
		['grave accent', 'D\u00e9p\u00f4t Goods'],
		['middle dot', 'G\u00b7Roast Coffee'],
	])('decodes valid UTF-8 bodies regardless of a legacy declared charset (%s)', async (_case, merchant) => {
		// Some feeds declare iso-8859-1 while emitting UTF-8 bytes; the bytes are authoritative.
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					transactions: [
						{
							transaction_id: 'multi-byte-1',
							transaction_amount: {currency: 'EUR', amount: '1.00'},
							credit_debit_indicator: 'DBIT',
							note: merchant,
							creditor: {name: merchant},
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json; charset=iso-8859-1'}},
			),
		);

		const transactions = await client.getAccountTransactions('account-id', {strategy: 'default'});

		expect(transactions).toEqual([expect.objectContaining({description: merchant, counterpartyName: merchant})]);
	});

	it('decodes legacy single-byte bodies with the declared charset', async () => {
		const body = JSON.stringify({
			transactions: [
				{
					transaction_id: 'declared-single-byte-1',
					transaction_amount: {currency: 'EUR', amount: '1.00'},
					credit_debit_indicator: 'DBIT',
					note: 'Grote Caf\u00e9 Ex\u00e6mple',
				},
			],
		});
		const bytes = Buffer.from(body, 'latin1') as unknown as ArrayBuffer;
		fetchMock.mockResolvedValueOnce(
			new Response(bytes, {status: 200, headers: {'content-type': 'application/json; charset=latin-1'}}),
		);

		const transactions = await client.getAccountTransactions('account-id', {strategy: 'default'});

		expect(transactions).toEqual([expect.objectContaining({description: 'Grote Café Exæmple'})]);
	});

	it('decodes legacy single-byte bodies without a charset declaration as windows-1252', async () => {
		const body = JSON.stringify({
			transactions: [
				{
					transaction_id: 'undeclared-single-byte-1',
					transaction_amount: {currency: 'EUR', amount: '1.00'},
					credit_debit_indicator: 'DBIT',
					note: 'Grote Caf\u00e9 Ex\u00e6mple',
				},
			],
		});
		const bytes = Buffer.from(body, 'latin1') as unknown as ArrayBuffer;
		fetchMock.mockResolvedValueOnce(
			new Response(bytes, {status: 200, headers: {'content-type': 'application/json'}}),
		);

		const transactions = await client.getAccountTransactions('account-id', {strategy: 'default'});

		expect(transactions).toEqual([expect.objectContaining({description: 'Grote Café Exæmple'})]);
	});

	it.each([
		['missing status', {accounts: ['account-1']}],
		['missing accounts', {status: 'AUTHORIZED'}],
		['non-string account ID', {status: 'AUTHORIZED', accounts: ['account-1', 2]}],
	])('rejects an incomplete session account response (%s)', async (_case, response) => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify(response), {
				status: 200,
				headers: {'content-type': 'application/json'},
			}),
		);

		await expect(client.getSessionAccounts('session-id')).rejects.toMatchObject({
			code: 'invalid_provider_response',
		});
	});

	it('maps account balances without retaining the provider response', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					balances: [
						{
							name: 'Available',
							balance_type: 'AVAILABLE',
							balance_amount: {currency: 'eur', amount: '12.34'},
							last_change_date_time: '2026-08-26T12:00:00Z',
							reference_date: '2026-08-26',
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.getAccountBalances('account-id')).resolves.toEqual([
			{
				name: 'Available',
				balanceType: 'AVAILABLE',
				amount: '12.34',
				currency: 'EUR',
				lastChangeDateTime: '2026-08-26T12:00:00Z',
				referenceDate: '2026-08-26',
				lastCommittedTransaction: undefined,
			},
		]);
	});

	it('serializes request-scoped PSU headers on session, balances and every transaction page without leaking to unattended calls', async () => {
		const psu = {ipAddress: '192.0.2.42', userAgent: 'ExampleBrowser/1.0'};
		const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200});
		fetchMock
			.mockResolvedValueOnce(json({status: 'AUTHORIZED', accounts: ['account-id']}))
			.mockResolvedValueOnce(json({balances: []}))
			.mockResolvedValueOnce(json({transactions: [], continuation_key: 'empty-page'}))
			.mockResolvedValueOnce(json({transactions: [], continuation_key: 'last-page'}))
			.mockResolvedValueOnce(json({transactions: []}))
			.mockResolvedValueOnce(json({status: 'AUTHORIZED', accounts: ['account-id']}))
			.mockResolvedValueOnce(json({balances: []}))
			.mockResolvedValueOnce(json({transactions: []}));
		await client.getSessionAccounts('session-id', undefined, psu);
		await client.getAccountBalances('account-id', undefined, psu);
		await client.getAccountTransactions('account-id', {strategy: 'longest'}, undefined, psu);
		await client.getSessionAccounts('session-id');
		await client.getAccountBalances('account-id');
		await client.getAccountTransactions('account-id', {strategy: 'longest'});
		expect(fetchMock).toHaveBeenCalledTimes(8);
		for (const [, init] of fetchMock.mock.calls.slice(0, 5) as [string, RequestInit][]) {
			const headers = new Headers(init.headers);
			expect(headers.get('Psu-Ip-Address')).toBe('192.0.2.42');
			expect(headers.get('Psu-User-Agent')).toBe('ExampleBrowser/1.0');
		}
		for (const [, init] of fetchMock.mock.calls.slice(5) as [string, RequestInit][]) {
			const headers = new Headers(init.headers);
			expect([...headers.keys()].filter((key) => key.startsWith('psu-'))).toEqual([]);
		}
	});

	it('follows continuation keys while mapping transaction pages', async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						transactions: [
							{
								transaction_id: 'transaction-1',
								entry_reference: 'entry-1',
								transaction_amount: {currency: 'EUR', amount: '2.50'},
								credit_debit_indicator: 'DBIT',
								status: 'BOOK',
								transaction_date: '2026-08-24',
								booking_date: '2026-08-26',
								creditor: {
									name: 'Shop',
									postal_address: {
										town_name: 'Exampletown',
										country_sub_division: 'Example Region',
										country: 'NL',
										street_name: 'Private Street',
										building_number: '99',
										post_code: '9999 ZZ',
									},
								},
								debtor: {
									postal_address: {
										town_name: 'Account Holder Town',
										country_sub_division: 'Account Holder Region',
										country: 'BE',
									},
								},
								bank_transaction_code: {
									code: 'PMNT',
									sub_code: 'CARD',
									description: 'Card payment',
								},
								balance_after_transaction: {currency: 'EUR', amount: '100.50'},
								exchange_rate: {
									unit_currency: 'USD',
									exchange_rate: '0.9234',
									rate_type: 'SPOT',
									instructed_amount: {currency: 'USD', amount: '2.71'},
								},
								reference_number: 'reference-1',
								reference_number_schema: 'RF',
								remittance_information: ['Groceries'],
							},
						],
						continuation_key: 'next-page',
					}),
					{status: 200, headers: {'content-type': 'application/json'}},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						transactions: [
							{
								transaction_id: 'transaction-2',
								transaction_amount: {currency: 'EUR', amount: '5.00'},
								credit_debit_indicator: 'CRDT',
								status: 'BOOK',
								value_date: '2026-08-25',
								creditor: {
									postal_address: {
										town_name: 'Creditor Town',
										country_sub_division: 'Creditor Region',
										country: 'DE',
									},
								},
								debtor: {
									name: 'Employer',
									postal_address: {
										town_name: 'Creditortown',
										country_sub_division: 'Credit Region',
										country: 'BE',
										street_name: 'Another Private Street',
										post_code: '1111 AA',
									},
								},
							},
						],
					}),
					{status: 200, headers: {'content-type': 'application/json'}},
				),
			);

		const transactions = await client.getAccountTransactions('account-id', {strategy: 'longest'});

		expect(transactions).toEqual([
			expect.objectContaining({
				providerTransactionId: 'transaction-1',
				entryReference: 'entry-1',
				currency: 'EUR',
				counterpartyName: 'Shop',
				counterpartyLocation: {
					city: 'Exampletown',
					region: 'Example Region',
					country: 'NL',
				},
				remittanceInformation: 'Groceries',
				transactionDate: '2026-08-24',
				valueDate: '2026-08-24',
				bankTransactionCode: 'PMNT',
				bankTransactionSubCode: 'CARD',
				bankTransactionDescription: 'Card payment',
				balanceAfterAmount: '100.50',
				balanceAfterCurrency: 'EUR',
				instructedAmount: '2.71',
				instructedCurrency: 'USD',
				exchangeRate: '0.9234',
				exchangeRateUnitCurrency: 'USD',
				exchangeRateType: 'SPOT',
				referenceNumber: 'reference-1',
				referenceNumberScheme: 'RF',
			}),
			expect.objectContaining({
				providerTransactionId: 'transaction-2',
				currency: 'EUR',
				counterpartyName: 'Employer',
				counterpartyLocation: {
					city: 'Creditortown',
					region: 'Credit Region',
					country: 'BE',
				},
			}),
		]);
		expect(JSON.stringify(transactions)).not.toContain('Private Street');
		expect(JSON.stringify(transactions)).not.toContain('9999 ZZ');
		expect(JSON.stringify(transactions)).not.toContain('Another Private Street');
		expect(JSON.stringify(transactions)).not.toContain('1111 AA');
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
		expect(firstUrl.pathname).toBe('/accounts/account-id/transactions');
		expect(firstUrl.searchParams.get('strategy')).toBe('longest');
		expect(firstUrl.searchParams.has('continuation_key')).toBe(false);

		const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
		expect(secondUrl.searchParams.get('continuation_key')).toBe('next-page');
	});

	it.each([
		{
			name: 'the creditor account IBAN for a debit',
			transaction: {
				credit_debit_indicator: 'DBIT',
				creditor_account: {iban: 'GB82 WEST 1234 5698 7654 32'},
				debtor_account: {iban: 'NL91ABNA0417164300'},
			},
			expected: 'GB82WEST12345698765432',
		},
		{
			name: 'the debtor account IBAN for a credit',
			transaction: {
				credit_debit_indicator: 'CRDT',
				creditor_account: {iban: 'NL91ABNA0417164300'},
				debtor_account: {iban: 'DE89370400440532013000'},
			},
			expected: 'DE89370400440532013000',
		},
		{
			name: 'nothing for an invalid account IBAN',
			transaction: {credit_debit_indicator: 'DBIT', creditor_account: {iban: 'GB82WEST12345698765433'}},
			expected: undefined,
		},
		{
			name: 'the SEPA description IBAN when the provider omits the counterparty account',
			transaction: {
				credit_debit_indicator: 'DBIT',
				remittance_information: ['SEPA Overboeking IBAN: GB82WEST12345698765432 BIC: TESTGB2L Naam: Example'],
			},
			expected: 'GB82WEST12345698765432',
		},
		{
			name: 'nothing when no IBAN is present',
			transaction: {credit_debit_indicator: 'DBIT', remittance_information: ['Groceries']},
			expected: undefined,
		},
	])('maps $name as the counterparty IBAN', async ({transaction, expected}) => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					transactions: [
						{
							transaction_id: 'transaction-iban',
							transaction_amount: {currency: 'EUR', amount: '10.00'},
							status: 'BOOK',
							booking_date: '2026-08-26',
							...transaction,
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		const [mappedTransaction] = await client.getAccountTransactions('account-id', {strategy: 'longest'});

		expect(mappedTransaction.counterpartyIban).toBe(expected);
	});

	it('omits location when the direction-selected counterparty is missing', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					transactions: [
						{
							transaction_id: 'debit-missing-creditor',
							transaction_amount: {currency: 'EUR', amount: '1.00'},
							credit_debit_indicator: 'DBIT',
							debtor: {
								postal_address: {
									town_name: 'Account Holder Town',
									country_sub_division: 'Account Holder Region',
									country: 'BE',
								},
							},
						},
						{
							transaction_id: 'credit-missing-debtor',
							transaction_amount: {currency: 'EUR', amount: '2.00'},
							credit_debit_indicator: 'CRDT',
							creditor: {
								postal_address: {
									town_name: 'Creditor Town',
									country_sub_division: 'Creditor Region',
									country: 'DE',
								},
							},
						},
						{
							transaction_id: 'unknown-direction',
							transaction_amount: {currency: 'EUR', amount: '3.00'},
							credit_debit_indicator: 'UNKNOWN',
							creditor: {
								postal_address: {town_name: 'Creditor Town', country: 'DE'},
							},
							debtor: {
								postal_address: {town_name: 'Account Holder Town', country: 'BE'},
							},
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		const transactions = await client.getAccountTransactions('account-id', {strategy: 'default'});

		expect(transactions).toHaveLength(3);
		for (const transaction of transactions) expect(transaction).not.toHaveProperty('counterpartyLocation');
	});

	it('cancels pagination before dispatching another PSU request', async () => {
		const controller = new AbortController();
		fetchMock.mockResolvedValue(new Response(JSON.stringify({transactions: []}), {status: 200}));
		fetchMock.mockImplementationOnce(async () => {
			controller.abort();
			return new Response(JSON.stringify({transactions: [], continuation_key: 'next-page'}), {status: 200});
		});
		await expect(
			client.getAccountTransactions('account-id', {strategy: 'longest'}, controller.signal, {
				ipAddress: '192.0.2.42',
				userAgent: 'ExampleBrowser/1.0',
			}),
		).rejects.toMatchObject({code: 'provider_unreachable'});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('propagates a supplied cancellation signal to transaction requests', async () => {
		const controller = new AbortController();
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({transactions: []}), {
				status: 200,
				headers: {'content-type': 'application/json'},
			}),
		);

		await client.getAccountTransactions('account-id', {strategy: 'default'}, controller.signal);

		const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
		expect(requestInit.signal).toEqual(expect.any(AbortSignal));
		expect(requestInit.signal?.aborted).toBe(false);
		controller.abort();
		expect(requestInit.signal?.aborted).toBe(true);
	});

	it('ignores malformed optional transaction metadata while retaining the transaction', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					transactions: [
						{
							transaction_amount: {currency: 'EUR', amount: '4.00'},
							transaction_date: 123,
							balance_after_transaction: {currency: 'EUR', amount: 'not-a-number'},
							exchange_rate: {
								unit_currency: 'US D',
								exchange_rate: 'invalid',
								instructed_amount: {currency: 'USDD', amount: '1.00'},
							},
							reference_number: 123,
						},
					],
				}),
				{status: 200, headers: {'content-type': 'application/json'}},
			),
		);

		await expect(client.getAccountTransactions('account-id', {strategy: 'default'})).resolves.toEqual([
			expect.objectContaining({
				amount: '4.00',
				transactionDate: undefined,
				balanceAfterAmount: undefined,
				balanceAfterCurrency: undefined,
				instructedAmount: undefined,
				instructedCurrency: undefined,
				exchangeRate: undefined,
				exchangeRateUnitCurrency: undefined,
				referenceNumber: undefined,
			}),
		]);
	});
});
