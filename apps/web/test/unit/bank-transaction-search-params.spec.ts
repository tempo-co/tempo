// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {bankTransactionSearchParamsSchema} from '../../src/features/banking/types/bank-transaction';

test('transaction list links keep the category filters the list knows and drop the rest', () => {
  expect(
    bankTransactionSearchParamsSchema.parse({
      categories: ['SHOPPING', 'RETIRED_CATEGORY', 'UNCATEGORIZED'],
    }),
  ).toMatchObject({categories: ['SHOPPING', 'UNCATEGORIZED']});
});
