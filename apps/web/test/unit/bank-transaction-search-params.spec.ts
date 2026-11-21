// A pure module's contract: no page, so this uses Playwright's own `test` rather than the app fixtures.
import {expect, test} from '@playwright/test';

import {bankTransactionSearchParamsSchema} from '../../src/features/banking/types/bank-transaction';

test('transaction list links keep the category filters the list knows, in their order, and drop the rest', () => {
  expect(
    bankTransactionSearchParamsSchema.parse({
      categories: ['UNCATEGORIZED', 'RETIRED_CATEGORY', 'SHOPPING'],
    }),
  ).toMatchObject({categories: ['UNCATEGORIZED', 'SHOPPING']});
});
