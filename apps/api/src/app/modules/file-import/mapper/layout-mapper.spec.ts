import Anthropic from '@anthropic-ai/sdk';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {ConfigurationService} from '@core/config/config.service';

import {sampleTable} from '../parsers/table-sample';
import {LAYOUT_MAPPER_TIMEOUT_MS, LayoutMapper, LayoutMapperError} from './layout-mapper';
import {
	LAYOUT_ANSWER_JSON_SCHEMA,
	LAYOUT_MAPPER_INSTRUCTIONS,
	LayoutAnswer,
	toMapperInput,
} from './layout-mapper.contract';

const FIXTURE = readFileSync(join(__dirname, '../../../../../test/fixtures/file-import/debit-credit-synthetic.csv'));
/** Everything of the fixture that is not its header: names, words, dates, amounts and the account. */
const FIXTURE_CONTENT = [
	'Example',
	'Beispiel',
	'GmbH',
	'Kartenzahlung',
	'Miete',
	'Gehalt',
	'Girokonto',
	'Kontonummer',
	'2026',
	'02.03',
	'12,50',
	'850',
	'2.500',
	'39,99',
	'DE89',
	'3704',
	'0130',
];

const ANSWER: LayoutAnswer = {
	bankName: 'Example Bank',
	dateFormat: 'DD.MM.YYYY',
	bookingDate: 0,
	valueDate: 1,
	amount: {kind: 'debitCredit', moneyOutColumn: 4, moneyInColumn: 5},
	decimalMark: ',',
	thousandsSeparator: '.',
	currency: {column: 6},
	balance: null,
	counterpartyName: 2,
	counterpartyAccount: null,
	description: [3],
	account: {line: 1},
};

function reply(text: string, overrides: Record<string, unknown> = {}) {
	return {stop_reason: 'end_turn', content: [{type: 'text', text}], usage: {}, ...overrides};
}

function setup(apiKey: string | null = 'synthetic-api-key') {
	const create = jest.fn();
	const config = {
		get: (key: string) =>
			({ANTHROPIC_API_KEY: apiKey ?? undefined, FILE_IMPORT_MAPPER_MODEL: 'claude-sonnet-5-5'})[
				key as 'ANTHROPIC_API_KEY'
			],
	} as unknown as ConfigurationService;
	return {mapper: new LayoutMapper(config, {messages: {create}} as never), create};
}

const input = () => toMapperInput(sampleTable(FIXTURE)!);

describe('LayoutMapper', () => {
	it('asks once, without tools and within 30 seconds, sending the header and nothing else of the file as written', async () => {
		const {mapper, create} = setup();
		create.mockResolvedValue(reply(JSON.stringify(ANSWER)));

		await expect(mapper.mapLayout(input())).resolves.toEqual(ANSWER);

		expect(create).toHaveBeenCalledTimes(1);
		const [request, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
		expect(request).toEqual({
			model: 'claude-sonnet-5-5',
			max_tokens: expect.any(Number),
			system: LAYOUT_MAPPER_INSTRUCTIONS,
			messages: [{role: 'user', content: expect.any(String)}],
			output_config: {effort: 'low', format: {type: 'json_schema', schema: LAYOUT_ANSWER_JSON_SCHEMA}},
		});
		expect(options).toEqual({timeout: LAYOUT_MAPPER_TIMEOUT_MS, maxRetries: 0});
		const body = JSON.stringify(request);
		expect(body).toContain('Auftraggeber/Empfänger');
		// Each column's shapes over the whole file: the money in column shows its thousands separator, which none of
		// the three sampled rows holds, and the currency column one value on every row.
		const sent = JSON.parse((request.messages as {content: string}[])[0].content) as {
			columns: {shapes: string[]; sameValue: boolean}[];
		};
		expect(sent.columns).toHaveLength(7);
		expect(sent.columns[5]).toEqual({shapes: ['', '9.999,99'], sameValue: true});
		expect(sent.columns[6]).toEqual({shapes: ['AAA'], sameValue: true});
		expect(LAYOUT_MAPPER_INSTRUCTIONS).toMatch(/columns lists/);
		for (const value of FIXTURE_CONTENT) expect(body).not.toContain(value);
	});

	it.each([
		{name: 'text that is not JSON', response: reply('The date is in column 1.')},
		{name: 'an answer outside the schema', response: reply(JSON.stringify({...ANSWER, bookingDate: 'Datum'}))},
		{name: 'an answer with an extra field', response: reply(JSON.stringify({...ANSWER, script: 'x'}))},
		{name: 'a reply cut off at the limit', response: reply(JSON.stringify(ANSWER), {stop_reason: 'max_tokens'})},
		{
			name: 'a reply that used a tool',
			response: {
				stop_reason: 'end_turn',
				content: [
					{type: 'server_tool_use', name: 'web_search', input: {}},
					{type: 'text', text: JSON.stringify(ANSWER)},
				],
				usage: {},
			},
		},
	])('refuses $name as an invalid answer, after one call', async ({response}) => {
		const {mapper, create} = setup();
		create.mockResolvedValue(response);

		await expect(mapper.mapLayout(input())).rejects.toEqual(new LayoutMapperError('invalid'));
		expect(create).toHaveBeenCalledTimes(1);
	});

	it.each([
		{name: 'a timeout', error: new Anthropic.APIConnectionTimeoutError()},
		{name: 'no credit', error: Object.assign(new Error('Your credit balance is too low.'), {status: 400})},
		{name: 'an overload', error: Object.assign(new Error('Overloaded.'), {status: 529})},
	])('is unavailable on $name, without a second call', async ({error}) => {
		const {mapper, create} = setup();
		create.mockRejectedValue(error);

		await expect(mapper.mapLayout(input())).rejects.toEqual(new LayoutMapperError('unavailable'));
		expect(create).toHaveBeenCalledTimes(1);
	});

	it('is unavailable without an API key, and asks nothing', async () => {
		const {mapper, create} = setup(null);

		await expect(mapper.mapLayout(input())).rejects.toEqual(new LayoutMapperError('unavailable'));
		expect(create).not.toHaveBeenCalled();
	});
});
