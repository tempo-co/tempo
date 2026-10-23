export const recurringQueryKeys = {
  root: ['recurring-series'] as const,
  lists: (asOf: string) => [...recurringQueryKeys.root, 'lists', asOf] as const,
  summary: (asOf: string) => [...recurringQueryKeys.root, 'summary', asOf] as const,
};
