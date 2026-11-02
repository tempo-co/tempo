import type {CashFlowInterval} from '@tempo/contracts';

/** Merchant totals are derived from transactions, so `invalidateBankDerivedData` marks them stale too. */
export const merchantQueryKeys = {
  root: ['merchants'] as const,
  list: (search: string) => [...merchantQueryKeys.root, 'list', search] as const,
  detail: (id: string) => [...merchantQueryKeys.root, 'detail', id] as const,
  periods: (id: string, interval: CashFlowInterval, from: string, to: string, asOf: string) =>
    [...merchantQueryKeys.root, 'periods', id, interval, from, to, asOf] as const,
  ranking: (interval: CashFlowInterval, period: string, asOf: string, limit: number) =>
    [...merchantQueryKeys.root, 'ranking', interval, period, asOf, limit] as const,
  /** Pages of one group's transactions; kept apart from transaction lists, whose caches hold one page. */
  transactions: (id: string) => [...merchantQueryKeys.root, 'transactions', id] as const,
};
