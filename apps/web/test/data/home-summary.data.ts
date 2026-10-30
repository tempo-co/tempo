import type {BankTransactionSummary} from '../../src/features/dashboard/types/bank-transaction-summary';

/** A synthetic September 2026 against a June–August baseline. */
export const septemberSummary: BankTransactionSummary = {
  month: '2026-09',
  through: '2026-09-30',
  daysInMonth: 30,
  baseCurrency: 'EUR',
  totals: {spending: '1200.00', income: '2500.00', net: '1300.00', ownTransfers: '300.00'},
  excluded: {unknownDirection: 1, missingBaseAmount: 2},
  baseline: {months: ['2026-06', '2026-07', '2026-08']},
  categories: [],
};

/** September with all of `spending` in one category, so Home shows it as a single row. */
export function septemberSpending(spending: string): BankTransactionSummary {
  return {
    ...septemberSummary,
    totals: {...septemberSummary.totals, spending},
    categories: [{category: 'OTHER', spending, count: 1, baselineAverage: null}],
  };
}
