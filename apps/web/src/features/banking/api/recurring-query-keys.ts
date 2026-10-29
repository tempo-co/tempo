export const recurringQueryKeys = {
  root: ['recurring-series'] as const,
  lists: (asOf: string) => [...recurringQueryKeys.root, 'lists', asOf] as const,
  summary: (asOf: string) => [...recurringQueryKeys.root, 'summary', asOf] as const,
  /** Pages of one series' payments; kept apart from transaction lists, whose caches hold one page. */
  payments: (seriesKey: string) => [...recurringQueryKeys.root, 'payments', seriesKey] as const,
};
