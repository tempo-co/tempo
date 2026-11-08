export const dashboardQueryKeys = {
  root: ['bank-dashboard'] as const,
  cashFlow: (interval: string, from: string, to: string, asOf: string) =>
    ['bank-dashboard', 'cash-flow', interval, from, to, asOf] as const,
  balanceTrend: (interval: string, from: string, to: string, asOf: string) =>
    ['bank-dashboard', 'balance-trend', interval, from, to, asOf] as const,
  breakdown: (interval: string, by: string, from: string, to: string, asOf: string) =>
    ['bank-dashboard', 'breakdown', interval, by, from, to, asOf] as const,
  /** Spending and income over a few days, where cash flow's periods are too coarse. */
  totals: (from: string, to: string) => ['bank-dashboard', 'totals', from, to] as const,
  /** One month's spending by category with each category's usual by the same day. */
  summary: (month: string, asOf: string) => ['bank-dashboard', 'summary', month, asOf] as const,
  reviewCounts: ['bank-dashboard', 'review-counts'] as const,
  /** Pages of a month's transactions; kept apart from transaction lists, whose caches hold one page. */
  monthTransactions: (from: string, to: string) =>
    ['bank-dashboard', 'month-transactions', from, to] as const,
};
