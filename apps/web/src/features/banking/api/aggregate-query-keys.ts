export const dashboardQueryKeys = {
  root: ['bank-dashboard'] as const,
  summary: (month: string, asOf: string) => ['bank-dashboard', 'summary', month, asOf] as const,
  reviewCounts: ['bank-dashboard', 'review-counts'] as const,
};
