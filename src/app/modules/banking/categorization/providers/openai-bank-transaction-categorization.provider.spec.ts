import {ConfigurationService} from '@core/config/config.service';

import {
	toBankTransactionCategorizationInput,
	toBankTransactionCategorizationWebSearchInput,
} from '../bank-transaction-categorization-input';
import {BankTransactionCategorizationProviderError} from '../bank-transaction-categorization.provider';
import {
	BankTransactionCategorizationInput,
	BankTransactionCategorizationWebSearchInput,
} from '../bank-transaction-categorization.types';
import {BANK_TRANSACTION_CATEGORIES, BANK_TRANSACTION_CATEGORY_DEFINITIONS} from '../bank-transaction-category';
import {OpenAiBankTransactionCategorizationProvider} from './openai-bank-transaction-categorization.provider';

function createInput(correlationId: string): BankTransactionCategorizationInput {
	return {
		correlationId,
		transactionDate: '2026-09-01',
		bookingDate: '2026-09-02',
		valueDate: null,
		amount: '-10.00',
		currency: 'EUR',
		creditDebitIndicator: 'DBIT',
		direction: 'EXPENSE',
		transactionType: 'CARD_PAYMENT',
		bankTransactionCode: 'PMNT',
		bankTransactionSubCode: 'CARD',
		description: 'Coffee shop',
		counterpartyName: 'Cafe',
		bankTransactionDescription: 'Card payment',
		merchantCategoryCode: '5814',
		remittanceInformation: 'Morning coffee',
	};
}

function createWebSearchInput(correlationId: string): BankTransactionCategorizationWebSearchInput {
	return {
		correlationId,
		amount: '-10.00',
		currency: 'EUR',
		direction: 'EXPENSE',
		transactionType: 'CARD_PAYMENT',
		merchantName: 'Example Cafe',
		merchantLocation: 'Testville',
		searchQuery: 'Example Cafe Testville',
		merchantCategoryCode: '5814',
	};
}

function createInputWithSensitiveText(correlationId: string): BankTransactionCategorizationInput {
	return toBankTransactionCategorizationInput({
		id: correlationId,
		transactionDate: '2026-09-01',
		bookingDate: '2026-09-02',
		valueDate: null,
		amount: '-18.99',
		currency: 'EUR',
		creditDebitIndicator: 'DBIT',
		bankTransactionCode: null,
		bankTransactionSubCode: null,
		description:
			'iDEAL purchase Example Merchant 2024 IBAN: NL00 TEST 0000 0000 00 BIC: TESTXX00 Ref: TXN-20260918-ABCD abc0123456789def01 0f1e2d3c4b5a69 9876543210987654 https://shop.example/orders/123456?token=sample-token sales@example.test',
		counterpartyName:
			'Example Merchant VOF BIC: TESTXX00 Order: 7654321 020 000 0000 card 9999 999999 99999 Account no: 1234/5678/90 Reference number: QZXB 2345.6789.77 Ref: ABCD 1234 Reference: AB12 3456 Reference number: 1234 AB12 Reference: 1234/ABCD.Reference number: 5678 Reference: 9876/ABCD-XYZ',
		bankTransactionDescription: 'Retail card purchase account: 0000 0000 0000 0000',
		merchantCategoryCode: '5999',
		remittanceInformation: 'Invoice 1234567 phone +1 202-555-0100 Mandate: MND123 contact seller@example.test',
	});
}

function createProvider() {
	const responsesCreate = jest.fn();
	const client = {responses: {create: responsesCreate}};
	const config = {
		get: jest.fn((key: string) => {
			if (key === 'OPENAI_API_KEY') return 'test-secret-api-key';
			if (key === 'AI_CATEGORIZATION_MODEL') return 'configured-model';
			throw new Error(`Unexpected config key: ${key}`);
		}),
	} as unknown as ConfigurationService;
	const provider = new OpenAiBankTransactionCategorizationProvider(config, client as never);
	return {provider, responsesCreate};
}

function output<T extends object>(classifications: readonly T[]) {
	return JSON.stringify({classifications});
}

function webOutput(classifications: readonly Omit<Record<string, unknown>, 'evidenceType'>[]) {
	return output(classifications.map((classification) => ({...classification, evidenceType: 'PURCHASE_CONTEXT'})));
}

describe('OpenAiBankTransactionCategorizationProvider', () => {
	it('sends a private strict structured request using the configured model', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: output([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.97}]),
		});
		const transactions = [createInput('transaction-1')];

		await expect(provider.categorize(transactions, BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
			{correlationId: 'transaction-1', category: 'FOOD_AND_DRINK', confidence: 0.97},
		]);

		expect(responsesCreate).toHaveBeenCalledTimes(1);
		const request = responsesCreate.mock.calls[0][0];
		expect(request).toMatchObject({
			model: 'configured-model',
			reasoning: {effort: 'low'},
			store: false,
		});
		expect(request).not.toHaveProperty('tools');
		expect(request.text.format).toMatchObject({
			type: 'json_schema',
			strict: true,
		});
		expect(request.text.format.schema.properties.classifications.items.properties.category).toEqual({
			type: 'string',
			enum: BANK_TRANSACTION_CATEGORIES,
		});
		expect(request.text.format.schema.additionalProperties).toBe(false);
		expect(request.text.format.schema.properties.classifications.items.additionalProperties).toBe(false);
		const sentInput = JSON.parse(request.input);
		expect(sentInput.transactions).toEqual([{...transactions[0], correlationId: '0'}]);
		expect(sentInput.categories).toEqual(BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		expect(request.instructions).toContain(
			'Treat each category description as scope and boundary guidance, not as a list of keywords.',
		);
		expect(request.instructions).toContain(
			'A clearly specialized merchant can support a category from merchant identity alone when its primary business maps directly to that category.',
		);
		expect(request.instructions).toContain(
			'Do not treat missing merchantCategoryCode or counterpartyName as evidence for OTHER',
		);
		expect(request.instructions).not.toContain(
			'For a card payment with no merchantCategoryCode and no counterpartyName, do not guess a specific category',
		);
		expect(request.input).not.toContain('test-secret-api-key');
	});

	it('serializes sanitized free-text fields for standard categorization', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: output([{correlationId: '0', category: 'SHOPPING', confidence: 0.8}]),
		});
		const transaction = createInputWithSensitiveText('transaction-1');

		await provider.categorize([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS);

		const request = responsesCreate.mock.calls[0][0];
		const serializedTransactions = JSON.stringify(JSON.parse(request.input).transactions);
		expect(serializedTransactions).not.toMatch(
			/NL00|TESTXX00|TXN-20260918-ABCD|abc0123456789def01|0f1e2d3c4b5a69|9876543210987654|7654321|0000|1234567|123456|MND123|020 000 0000|000000|9999|999999|1234|5678|90|2345|6789|77|QZXB|ABCD|AB12|3456|9876|XYZ|sample-token|seller@example\.test|\+1 202-555-0100/,
		);
		expect(serializedTransactions).toContain('iDEAL purchase Example Merchant 2024');
		expect(serializedTransactions).toContain('Example Merchant VOF');
		expect(serializedTransactions).toContain('Retail card purchase');
		expect(JSON.parse(request.input).transactions[0]).toMatchObject({
			transactionDate: '2026-09-01',
			amount: '-18.99',
			currency: 'EUR',
			merchantCategoryCode: '5999',
		});
	});

	it('keeps the web-search request and query free of redacted identifiers', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'SHOPPING', confidence: 0.8}]),
		});
		const transaction = createInputWithSensitiveText('transaction-1');
		const webSearchInput = toBankTransactionCategorizationWebSearchInput(transaction);
		expect(webSearchInput).toMatchObject({
			merchantName: 'Example Merchant VOF',
			searchQuery: 'Example Merchant VOF',
		});
		if (!webSearchInput) throw new Error('Expected a merchant web-search input.');

		await provider.categorizeWithWebSearch([webSearchInput], BANK_TRANSACTION_CATEGORY_DEFINITIONS);

		const request = responsesCreate.mock.calls[0][0];
		const serializedRequest = JSON.stringify(request);
		expect(serializedRequest).not.toMatch(
			/NL00|TESTXX00|TXN-20260918-ABCD|abc0123456789def01|0f1e2d3c4b5a69|9876543210987654|7654321|0000|1234567|123456|MND123|020 000 0000|000000|9999|999999|1234|5678|90|2345|6789|77|QZXB|ABCD|AB12|3456|9876|XYZ|sample-token|seller@example\.test|\+1 202-555-0100/,
		);
		expect(request.input).toContain('Example Merchant VOF');
		expect(request.input).not.toContain('[REDACTED]');
		expect(request.instructions).toContain('Use exactly the supplied searchQuery as the only search query.');
		expect(request.instructions).toContain('For TRANSPORTATION, merchant identity is enough only when');
		expect(request.instructions).toContain(
			'Logistics, parcel, courier, freight, and food or grocery delivery services do not qualify.',
		);
		expect(request.instructions).toContain('need descriptor or purchase evidence of a ride or of fuel');
	});

	it('maps compact provider correlation IDs back to the original transaction IDs', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: output([
				{correlationId: '1', category: 'SHOPPING', confidence: 0.71},
				{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.93},
			]),
		});
		const transactions = [createInput('transaction-1'), createInput('transaction-2')];

		await expect(provider.categorize(transactions, BANK_TRANSACTION_CATEGORY_DEFINITIONS)).resolves.toEqual([
			{correlationId: 'transaction-2', category: 'SHOPPING', confidence: 0.71},
			{correlationId: 'transaction-1', category: 'FOOD_AND_DRINK', confidence: 0.93},
		]);
	});

	it('returns NEEDS_REVIEW when the available evidence is insufficient', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: output([{correlationId: '0', category: 'NEEDS_REVIEW', confidence: 0}]),
		});

		await expect(
			provider.categorize([createInput('transaction-1')], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).resolves.toEqual([{correlationId: 'transaction-1', category: 'NEEDS_REVIEW', confidence: 0}]);
	});

	it('uses the hosted web-search tool for a sanitized fallback request', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.93}]),
			output: [
				{
					type: 'web_search_call',
					status: 'completed',
					action: {
						type: 'search',
						queries: ['Example Cafe Testville coffee vending Testland'],
						sources: [
							{type: 'url', url: 'https://www.example.com/acme'},
							{type: 'url', url: 'https://news.example.org/acme'},
						],
					},
				},
			],
		});
		const transactions = [createWebSearchInput('opaque-transaction-id')];

		await expect(
			provider.categorizeWithWebSearch(transactions, BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).resolves.toEqual([
			{
				correlationId: 'opaque-transaction-id',
				category: 'FOOD_AND_DRINK',
				confidence: 0.93,
				searchTrace: {
					queries: ['Example Cafe Testville'],
					sourceDomains: ['example.com', 'news.example.org'],
					evidenceType: 'PURCHASE_CONTEXT',
				},
			},
		]);

		expect(responsesCreate).toHaveBeenCalledTimes(1);
		const request = responsesCreate.mock.calls[0][0];
		expect(request).toMatchObject({
			model: 'configured-model',
			reasoning: {effort: 'medium'},
			tool_choice: 'required',
			max_tool_calls: 1,
			parallel_tool_calls: false,
			store: false,
		});
		expect(request.tools).toEqual([
			{
				type: 'web_search',
				external_web_access: true,
				search_context_size: 'medium',
			},
		]);
		expect(request.include).toEqual(['web_search_call.action.sources']);
		expect(request.text.format).toMatchObject({
			type: 'json_schema',
			strict: true,
		});

		const sentInput = JSON.parse(request.input);
		expect(sentInput.transactions).toEqual([{...transactions[0], correlationId: '0'}]);
		expect(sentInput.categories).toEqual(BANK_TRANSACTION_CATEGORY_DEFINITIONS);
		expect(request.text.format.schema.properties.classifications.items.properties).not.toHaveProperty(
			'needsFollowUp',
		);
		expect(request.instructions).toContain('Do not perform a follow-up lookup.');
		expect(request.instructions).toContain('Use exactly the supplied searchQuery as the only search query.');
		expect(request.instructions).toContain(
			'Treat each category description as scope and boundary guidance, not as a list of keywords.',
		);
		expect(request.instructions).toContain(
			'A clearly specialized merchant can support a category from merchant identity alone when its primary business maps directly to that category.',
		);
		expect(request.instructions).not.toContain('Do not choose Transportation from incidental corporate activity');
		expect(request.instructions).not.toContain('A merchant evidenced as supplying workplace coffee');
		expect(request.input).toContain('Require evidence of an actual transportation purchase');
		expect(request.input).toContain(
			'equipment, installation, servicing, fuel, and other non-food purchases are excluded',
		);
		expect(request.input).not.toContain('opaque-transaction-id');
		expect(request.input).not.toContain('provider-id');
		expect(request.input).not.toContain('account-id');
		expect(request.input).not.toContain('IBAN');
		expect(request.input).not.toContain('remittance');
	});

	it('passes a known approximate location to web search without increasing context size', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'OTHER', confidence: 0.3}]),
		});
		const transaction = {
			...createWebSearchInput('opaque-transaction-id'),
			approximateLocation: {
				city: 'Exampletown',
				region: 'Example Region',
				country: 'NL',
			},
		} satisfies BankTransactionCategorizationWebSearchInput;

		await provider.categorizeWithWebSearch([transaction], BANK_TRANSACTION_CATEGORY_DEFINITIONS);

		const request = responsesCreate.mock.calls[0][0];
		expect(request.tools).toEqual([
			{
				type: 'web_search',
				external_web_access: true,
				search_context_size: 'medium',
				user_location: {
					type: 'approximate',
					city: 'Exampletown',
					region: 'Example Region',
					country: 'NL',
				},
			},
		]);
		const sentInput = JSON.parse(request.input);
		expect(sentInput.transactions[0]).not.toHaveProperty('approximateLocation');
		expect(JSON.stringify(request)).not.toContain('Private Street');
		expect(JSON.stringify(request)).not.toContain('9999 ZZ');
	});

	it('stores only the supplied search query and source hostnames in the search trace', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'OTHER', confidence: 0.2}]),
			output: [
				{
					type: 'web_search_call',
					status: 'completed',
					action: {
						type: 'search',
						queries: ['ACME 1234567 someone@example.com NL00TEST0000000000'],
						sources: [{type: 'url', url: 'https://www.example.com/private/path?token=secret'}],
					},
				},
			],
		});

		const [result] = await provider.categorizeWithWebSearch(
			[createWebSearchInput('transaction-1')],
			BANK_TRANSACTION_CATEGORY_DEFINITIONS,
		);

		expect(result.searchTrace).toEqual({
			queries: ['Example Cafe Testville'],
			sourceDomains: ['example.com'],
			evidenceType: 'PURCHASE_CONTEXT',
		});
		expect(JSON.stringify(result)).not.toContain('someone@example.com');
		expect(JSON.stringify(result)).not.toContain('1234567');
		expect(JSON.stringify(result)).not.toContain('private/path');
	});

	it('does not perform a follow-up lookup when the initial result is ambiguous', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'OTHER', confidence: 0.3}]),
		});

		await expect(
			provider.categorizeWithWebSearch(
				[createWebSearchInput('transaction-1')],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			),
		).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'OTHER',
				confidence: 0.3,
				searchTrace: {queries: ['Example Cafe Testville'], sourceDomains: [], evidenceType: 'PURCHASE_CONTEXT'},
			},
		]);

		expect(responsesCreate).toHaveBeenCalledTimes(1);
	});

	it('performs one lookup per transaction even when results are ambiguous', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'OTHER', confidence: 0.4}]),
		});
		const transactions = [createWebSearchInput('transaction-1'), createWebSearchInput('transaction-2')];

		await expect(
			provider.categorizeWithWebSearch(transactions, BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'OTHER',
				confidence: 0.4,
				searchTrace: {queries: ['Example Cafe Testville'], sourceDomains: [], evidenceType: 'PURCHASE_CONTEXT'},
			},
			{
				correlationId: 'transaction-2',
				category: 'OTHER',
				confidence: 0.4,
				searchTrace: {queries: ['Example Cafe Testville'], sourceDomains: [], evidenceType: 'PURCHASE_CONTEXT'},
			},
		]);

		expect(responsesCreate).toHaveBeenCalledTimes(2);
		expect(responsesCreate.mock.calls.every(([request]) => request.max_tool_calls === 1)).toBe(true);
		expect(
			responsesCreate.mock.calls.every(([request]) =>
				request.instructions.includes('Do not perform a follow-up lookup.'),
			),
		).toBe(true);
	});

	it('drops invalid merchant category codes from web-search requests', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.93}]),
		});

		await provider.categorizeWithWebSearch(
			[{...createWebSearchInput('transaction-1'), merchantCategoryCode: 'not-an-mcc'}],
			BANK_TRANSACTION_CATEGORY_DEFINITIONS,
		);

		const sentInput = JSON.parse(responsesCreate.mock.calls[0][0].input);
		expect(sentInput.transactions[0].merchantCategoryCode).toBeNull();
	});

	it('keeps a clear OTHER result without a follow-up lookup', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({
			output_text: webOutput([{correlationId: '0', category: 'OTHER', confidence: 0.7}]),
		});

		await expect(
			provider.categorizeWithWebSearch(
				[createWebSearchInput('transaction-1')],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			),
		).resolves.toEqual([
			{
				correlationId: 'transaction-1',
				category: 'OTHER',
				confidence: 0.7,
				searchTrace: {queries: ['Example Cafe Testville'], sourceDomains: [], evidenceType: 'PURCHASE_CONTEXT'},
			},
		]);
		expect(responsesCreate).toHaveBeenCalledTimes(1);
	});

	it.each([
		[
			'unknown category',
			JSON.stringify({classifications: [{correlationId: '0', category: 'UNKNOWN', confidence: 0.5}]}),
		],
		[
			'duplicate correlation ID',
			JSON.stringify({
				classifications: [
					{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.5},
					{correlationId: '0', category: 'SHOPPING', confidence: 0.5},
				],
			}),
		],
		['malformed JSON', '{not-json'],
	] as const)('rejects web-search %s', async (_case, responseText) => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({output_text: responseText});

		await expect(
			provider.categorizeWithWebSearch(
				[createWebSearchInput('transaction-1')],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			),
		).rejects.toMatchObject<Partial<BankTransactionCategorizationProviderError>>({retryable: true});
	});

	it.each([
		[503, true],
		[400, false],
	] as const)('maps web-search provider status %s to retryable=%s', async (status, retryable) => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockRejectedValue({status, name: 'APIError'});

		await expect(
			provider.categorizeWithWebSearch(
				[createWebSearchInput('transaction-1')],
				BANK_TRANSACTION_CATEGORY_DEFINITIONS,
			),
		).rejects.toMatchObject<Partial<BankTransactionCategorizationProviderError>>({retryable});
	});

	it('does not construct the SDK when no OpenAI key is configured', () => {
		const config = {
			get: jest.fn((key: string) => {
				if (key === 'AI_CATEGORIZATION_MODEL') return 'configured-model';
				if (key === 'OPENAI_API_KEY') return undefined;
				throw new Error(`Unexpected config key: ${key}`);
			}),
		} as unknown as ConfigurationService;

		expect(() => new OpenAiBankTransactionCategorizationProvider(config)).not.toThrow();
	});

	it.each([
		[
			'unknown category',
			JSON.stringify({classifications: [{correlationId: '0', category: 'UNKNOWN', confidence: 0.5}]}),
		],
		[
			'duplicate correlation ID',
			JSON.stringify({
				classifications: [
					{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 0.5},
					{correlationId: '0', category: 'SHOPPING', confidence: 0.5},
				],
			}),
		],
		[
			'missing correlation ID',
			JSON.stringify({
				classifications: [{correlationId: 'other-id', category: 'FOOD_AND_DRINK', confidence: 0.5}],
			}),
		],
		[
			'invalid confidence',
			JSON.stringify({
				classifications: [{correlationId: '0', category: 'FOOD_AND_DRINK', confidence: 2}],
			}),
		],
		['malformed JSON', '{not-json'],
	] as const)('rejects %s before returning results', async (_case, responseText) => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockResolvedValue({output_text: responseText});

		await expect(
			provider.categorize([createInput('transaction-1')], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).rejects.toMatchObject<Partial<BankTransactionCategorizationProviderError>>({retryable: true});
	});

	it.each([
		[undefined, true],
		[408, true],
		[429, true],
		[500, true],
		[503, true],
		[400, false],
		[401, false],
		[403, false],
		[404, false],
	] as const)('maps provider status %s to retryable=%s', async (status, retryable) => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockRejectedValue({
			status,
			name: status === undefined ? 'APIConnectionTimeoutError' : 'APIError',
		});

		await expect(
			provider.categorize([createInput('transaction-1')], BANK_TRANSACTION_CATEGORY_DEFINITIONS),
		).rejects.toMatchObject<Partial<BankTransactionCategorizationProviderError>>({retryable});
	});

	it('does not expose credentials, input, or raw provider errors', async () => {
		const {provider, responsesCreate} = createProvider();
		responsesCreate.mockRejectedValue({
			status: 500,
			name: 'APIError',
			message: 'test-secret-api-key Coffee shop raw provider body',
			response: {data: 'Coffee shop raw provider body'},
		});

		const error = await provider
			.categorize([createInput('transaction-1')], BANK_TRANSACTION_CATEGORY_DEFINITIONS)
			.catch((value: unknown) => value);

		expect(error).toBeInstanceOf(BankTransactionCategorizationProviderError);
		if (!(error instanceof BankTransactionCategorizationProviderError)) throw new Error('Expected provider error.');
		expect(error.message).not.toContain('test-secret-api-key');
		expect(error.message).not.toContain('Coffee shop');
		expect(error.message).not.toContain('raw provider body');
	});
});
