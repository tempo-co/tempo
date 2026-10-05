import type {BankTransactionSummary} from '../../src/features/dashboard/types/bank-transaction-summary';

const money = (cents: number) => (cents / 100).toFixed(2);
const days = (count: number) => Array.from({length: count}, (_, index) => index + 1);

/**
 * A synthetic September 2026: €40 spent every day against a June–August baseline that averages
 * €45 a day, ranging from €35 to €55.
 */
export const septemberSummary: BankTransactionSummary = {
  month: '2026-09',
  through: '2026-09-30',
  daysInMonth: 30,
  baseCurrency: 'EUR',
  totals: {spending: '1200.00', income: '2500.00', net: '1300.00', ownTransfers: '300.00'},
  excluded: {unknownDirection: 1, missingBaseAmount: 2},
  daily: days(30).map((day) => ({day, spending: '40.00', cumulative: money(4000 * day)})),
  baseline: {
    months: ['2026-06', '2026-07', '2026-08'],
    daily: days(30).map((day) => ({
      day,
      average: money(4500 * day),
      low: money(3500 * day),
      high: money(5500 * day),
    })),
    spendingByThrough: '1350.00',
    incomeByThrough: '2400.00',
  },
  categories: [],
};

/** The same month spending more than any baseline month did. */
export const septemberAboveRangeSummary: BankTransactionSummary = {
  ...septemberSummary,
  totals: {...septemberSummary.totals, spending: '2000.00', net: '500.00'},
};

/** The first synced month: nothing earlier to compare with and nothing left out. */
export const firstMonthSummary: BankTransactionSummary = {
  ...septemberSummary,
  excluded: {unknownDirection: 0, missingBaseAmount: 0},
  baseline: {months: [], daily: [], spendingByThrough: null, incomeByThrough: null},
};

/** One month of history only, so there is an average but no range. */
export const oneBaselineMonthSummary: BankTransactionSummary = {
  ...septemberSummary,
  baseline: {
    ...septemberSummary.baseline,
    months: ['2026-08'],
    daily: septemberSummary.baseline.daily.map((day) => ({...day, low: null, high: null})),
  },
};

/** October 2026 through the 1st, the seeded browser clock's current month. */
export const octoberFirstSummary: BankTransactionSummary = {
  ...septemberSummary,
  month: '2026-10',
  through: '2026-10-01',
  daysInMonth: 31,
  totals: {spending: '60.00', income: '0.00', net: '-60.00', ownTransfers: '0.00'},
  daily: [{day: 1, spending: '60.00', cumulative: '60.00'}],
  baseline: {
    ...septemberSummary.baseline,
    daily: days(31).map((day) => ({
      day,
      average: money(4500 * day),
      low: money(3500 * day),
      high: money(5500 * day),
    })),
    spendingByThrough: '45.00',
    incomeByThrough: '0.00',
  },
};
