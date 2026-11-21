import {bicBankIdentity, differentBanks, nameBankIdentity, strongerBankIdentity} from './bank-identity';

describe('strongerBankIdentity', () => {
	it.each([
		['a name over a BIC', nameBankIdentity('Example Bank'), bicBankIdentity('EXMPDEFF'), 'name:example bank'],
		['the first-sorting BIC of two', bicBankIdentity('EXMPNL2A'), bicBankIdentity('EXMPDEFF'), 'bic:EXMPDEFF'],
		['the first-sorting name of two', nameBankIdentity('Knab'), nameBankIdentity('ING'), 'name:ing'],
		['the one evidence given', null, bicBankIdentity('EXMPDEFF'), 'bic:EXMPDEFF'],
	])('keeps %s, whichever statement comes first', (_case, left, right, kept) => {
		expect(strongerBankIdentity(left, right)).toBe(kept);
		expect(strongerBankIdentity(right, left)).toBe(kept);
	});

	it('records no bank when no statement names one', () => {
		expect(strongerBankIdentity(null, null)).toBeNull();
	});
});

describe('differentBanks', () => {
	it.each([
		['two BICs', bicBankIdentity('EXMPDEFF'), bicBankIdentity('EXMPNL2A'), true],
		['two names', nameBankIdentity('Example Bank'), nameBankIdentity('Knab'), true],
		['one name spelled two ways', nameBankIdentity('Example  Bank'), nameBankIdentity('example bank'), false],
		['a name and a BIC', nameBankIdentity('Example Bank'), bicBankIdentity('EXMPDEFF'), false],
		['missing evidence', null, bicBankIdentity('EXMPDEFF'), false],
	])('proves %s different banks: %s', (_case, left, right, different) => {
		expect(differentBanks(left, right)).toBe(different);
		expect(differentBanks(right, left)).toBe(different);
	});
});
