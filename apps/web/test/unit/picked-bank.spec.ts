// Pure modules' contracts: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';
import {BANK_LIST, type Bank} from '@tempo/contracts';

import {catalogMatch} from '../../src/features/file-import/utils/picked-bank';

const bank = (fields: Pick<Bank, 'name' | 'country'> & Partial<Pick<Bank, 'logoCountry'>>) =>
  fields;

test("a listed bank's logo is the connectable bank of its name and country", () => {
  const catalog = [
    {name: 'Example Bank', country: 'DE', logoUrl: 'de'},
    {name: 'EXAMPLE  bank', country: 'NL', logoUrl: 'nl'},
    {name: 'Example App', country: 'LT', logoUrl: 'lt'},
    {name: 'Example Savings', country: 'NL', logoUrl: 'savings'},
  ];
  // Case and spacing aside, in the bank's own country.
  expect(catalogMatch(bank({name: 'Example Bank', country: 'NL'}), catalog)?.logoUrl).toBe('nl');
  // The list's note in brackets is no part of the name.
  expect(
    catalogMatch(bank({name: 'Example Savings (also Example Regional)', country: 'NL'}), catalog)
      ?.logoUrl,
  ).toBe('savings');
  // A bank of several countries is looked up in its home country.
  expect(
    catalogMatch(bank({name: 'Example App', country: null, logoCountry: 'LT'}), catalog)?.logoUrl,
  ).toBe('lt');
  expect(catalogMatch(bank({name: 'Example App', country: null}), catalog)).toBeUndefined();
  expect(catalogMatch(bank({name: 'Example Bank', country: 'FR'}), catalog)).toBeUndefined();
});

test('every listed bank of several countries names the home country its logo is under', () => {
  expect(
    BANK_LIST.filter((listed) => listed.country === null && !listed.logoCountry).map(({id}) => id),
  ).toEqual([]);
});
