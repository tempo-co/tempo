import {BANK_IMPORT_FORMATS, BANK_LIST, OTHER_BANK_EXPORT_TEXT} from '@wisp/contracts';

import {CSV_LAYOUTS} from './csv-layouts';

describe('the bank list and the built-in readers', () => {
	const layoutIds = CSV_LAYOUTS.map(({id}) => id);
	const verified = BANK_LIST.filter(({status}) => status === 'verified');

	it('names for every verified bank at least one reader, each an existing built-in layout or standard format', () => {
		const standardFormats: readonly string[] = BANK_IMPORT_FORMATS.filter(
			(format) => format !== 'csv' && format !== 'mixed',
		);
		const problems = verified.flatMap((bank) => [
			...(bank.layouts.length + bank.formats.length === 0 ? [`${bank.id} names no reader`] : []),
			...bank.layouts
				.filter((id) => !layoutIds.includes(id))
				.map((id) => `${bank.id} names missing layout ${id}`),
			...bank.formats
				.filter((format) => !standardFormats.includes(format))
				.map((format) => `${bank.id} names unknown format ${format}`),
		]);
		expect(verified.length).toBeGreaterThan(0);
		expect(problems).toEqual([]);
	});

	it('lists every built-in layout under a verified bank', () => {
		const listed = new Set(verified.flatMap(({layouts}) => layouts));
		expect(layoutIds.filter((id) => !listed.has(id))).toEqual([]);
	});

	it('names readers only for verified banks', () => {
		const unverifiedWithReaders = BANK_LIST.filter(
			({status, layouts, formats}) => status === 'unverified' && layouts.length + formats.length > 0,
		).map(({id}) => id);
		expect(unverifiedWithReaders).toEqual([]);
	});

	it('gives every listed bank a unique id, numbered export steps and the file to choose', () => {
		const ids = BANK_LIST.map(({id}) => id);
		expect(new Set(ids).size).toBe(ids.length);
		const withoutSteps = BANK_LIST.filter(
			({exportSteps}) => exportSteps.steps.length === 0 || exportSteps.file === '',
		).map(({id}) => id);
		expect(withoutSteps).toEqual([]);
		expect(OTHER_BANK_EXPORT_TEXT).not.toBe('');
	});
});
