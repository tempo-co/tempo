import {bicBankIdentity, nameBankIdentity, strongerBankIdentity} from './bank-identity';

describe('strongerBankIdentity', () => {
	it.each([
		['a name over a BIC', nameBankIdentity('Example Bank'), bicBankIdentity('EXMPDEFFXXX'), 'name:example bank'],
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
