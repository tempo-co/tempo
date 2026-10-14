export const dashboardQueryKeys = {
  root: ['bank-dashboard'] as const,
  summary: (month: string, asOf: string) => ['bank-dashboard', 'summary', month, asOf] as const,
  cashFlow: (interval: string, from: string, to: string, asOf: string) =>
    ['bank-dashboard', 'cash-flow', interval, from, to, asOf] as const,
  reviewCounts: ['bank-dashboard', 'review-counts'] as const,
};
