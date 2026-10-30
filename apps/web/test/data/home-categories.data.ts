import type {BankTransactionSummary} from '../../src/features/dashboard/types/bank-transaction-summary';
import {septemberSummary} from './home-summary.data';

/** Synthetic category totals, including two hidden categories and a refund. */
export const categorySummary: BankTransactionSummary = {
  ...septemberSummary,
  totals: {...septemberSummary.totals, spending: '2025.00', net: '475.00'},
  categories: [
    {category: 'HOUSING_AND_UTILITIES', spending: '1000.00', count: 2, baselineAverage: '1000.00'},
    {category: 'FOOD_AND_DRINK', spending: '400.00', count: 12, baselineAverage: '200.00'},
    {category: 'TRANSPORTATION', spending: '300.00', count: 6, baselineAverage: '400.00'},
    {category: 'SHOPPING', spending: '200.00', count: 3, baselineAverage: '180.00'},
    {category: 'SUBSCRIPTIONS', spending: '80.00', count: 1, baselineAverage: '10.00'},
    {category: 'UNCATEGORIZED', spending: '50.00', count: 2, baselineAverage: null},
    {category: 'TRANSFER_OUT', spending: '20.00', count: 1, baselineAverage: '0.00'},
    {category: 'OTHER', spending: '15.00', count: 1, baselineAverage: null},
    {category: 'REFUND', spending: '-40.00', count: 1, baselineAverage: null},
  ],
};
