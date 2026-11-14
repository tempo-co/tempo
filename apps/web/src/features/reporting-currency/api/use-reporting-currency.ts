import {queryOptions, useQuery, useQueryClient} from '@tanstack/react-query';
import type {ReportingCurrency} from '@tempo/contracts';
import {useEffect} from 'react';

import {dashboardQueryKeys} from '@/features/banking/api/aggregate-query-keys';
import {bankQueryKeys} from '@/features/banking/api/query-keys';
import {recurringQueryKeys} from '@/features/banking/api/recurring-query-keys';
import {merchantQueryKeys} from '@/features/merchants/api/merchant-query-keys';
import {api} from '@/utils/api';

/** The money queries; their responses name the currency their figures are in (`baseCurrency`). */
const MONEY_QUERY_ROOTS = [
  dashboardQueryKeys.root,
  bankQueryKeys.transactionsRoot,
  bankQueryKeys.transactionRoot,
  recurringQueryKeys.root,
  merchantQueryKeys.root,
  bankQueryKeys.connections,
];

/** How often a currency change in progress is checked on. */
const RECALCULATING_POLL_INTERVAL_MS = 3_000;

export const reportingCurrencyQueryKey = bankQueryKeys.reportingCurrency;

export const reportingCurrencyQueryOptions = queryOptions({
  queryKey: reportingCurrencyQueryKey,
  queryFn: () => api.get<ReportingCurrency>('/reporting-currency'),
});

/**
 * Drops every cached money figure, in the old or no currency, once the currency changes or its amounts are ready:
 * kept on screen while the new ones load, an old figure would be added to new ones under the new currency's name.
 */
export function resetMoneyFigures(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all(MONEY_QUERY_ROOTS.map((queryKey) => queryClient.resetQueries({queryKey})));
}

/**
 * Whether the reporting currency is known well enough to show figures: loaded, failed (figures then show as they did
 * before owners could choose), or waiting for a connection, where saved figures show as before.
 */
export function reportingCurrencyKnown({
  isPending,
  fetchStatus,
}: Pick<ReturnType<typeof useReportingCurrency>, 'isPending' | 'fetchStatus'>) {
  return !isPending || fetchStatus === 'paused';
}

/**
 * Whether combined figures can be shown: once the reporting currency is known, unless the owner still has to choose
 * one to add them up in, or amounts are being converted into a new one.
 */
export function moneyFiguresReady(query: ReturnType<typeof useReportingCurrency>) {
  const {data} = query;
  return (
    reportingCurrencyKnown(query) &&
    !data?.recalculating &&
    !(data?.setupRequired && data.currency === null)
  );
}

type QueryClient = ReturnType<typeof useQueryClient>;
type Seen = Pick<ReportingCurrency, 'currency' | 'recalculating'>;

/** The reporting currency each client last acted on, shared by every component that reads it. */
const lastSeen = new WeakMap<QueryClient, Seen>();

/**
 * Records `settings` as seen, and says whether cached figures are now stale: the currency changed, wherever that
 * happened (this tab, another tab or device), or its amounts just became ready. The first sighting changes nothing.
 */
export function noteReportingCurrency(queryClient: QueryClient, settings: Seen) {
  const before = lastSeen.get(queryClient);
  lastSeen.set(queryClient, {currency: settings.currency, recalculating: settings.recalculating});
  return (
    before !== undefined &&
    (before.currency !== settings.currency || (before.recalculating && !settings.recalculating))
  );
}

/**
 * The owner's reporting currency. While amounts are being converted into a new one it checks back every few seconds.
 * Whenever it changes, or its amounts become ready, it drops every figure that adds amounts up.
 */
export function useReportingCurrency() {
  const queryClient = useQueryClient();
  const query = useQuery({
    ...reportingCurrencyQueryOptions,
    refetchInterval: ({state}) =>
      state.data?.recalculating ? RECALCULATING_POLL_INTERVAL_MS : false,
  });
  const currency = query.data?.currency;
  const recalculating = query.data?.recalculating;
  useEffect(() => {
    if (currency === undefined || recalculating === undefined) return;
    if (noteReportingCurrency(queryClient, {currency, recalculating}))
      void resetMoneyFigures(queryClient);
  }, [queryClient, currency, recalculating]);
  return query;
}

/**
 * Whether figures a response names `currency` for may be shown: only in the reporting currency, and not while its
 * amounts are being converted. Without the settings (not loaded or failed to), as before owners could choose.
 */
export function figuresCurrencyAccepted(
  settings: ReportingCurrency | undefined,
  currency: string | null | undefined,
) {
  return !settings || (!settings.recalculating && currency === settings.currency);
}

/** {@link figuresCurrencyAccepted} for the cached settings, without loading them. */
export function useFiguresCurrencyAccepted() {
  const {data: settings} = useQuery({...reportingCurrencyQueryOptions, enabled: false});
  return (currency: string | null | undefined) => figuresCurrencyAccepted(settings, currency);
}

const responseCurrency = (data: unknown): string | null | undefined => {
  const first: unknown = Array.isArray(data) ? (data as unknown[])[0] : data;
  return typeof first === 'object' && first !== null && 'baseCurrency' in first
    ? (first as {baseCurrency: string | null}).baseCurrency
    : undefined;
};

/**
 * Reads the reporting currency again whenever a money response names another currency than the cached settings,
 * or none: it was changed elsewhere or is being converted. That brings the settings, and with them every figure,
 * up to date without polling them. Mount once, at the app root.
 */
export function useWatchTotalsCurrency() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success') return;
        const [key] = event.query.queryKey as readonly unknown[];
        if (!MONEY_QUERY_ROOTS.some((root) => root[0] === key)) return;
        const currency = responseCurrency(event.query.state.data);
        if (currency === undefined) return;
        const settings = queryClient.getQueryState<ReportingCurrency>(reportingCurrencyQueryKey);
        if (!settings?.data || settings.fetchStatus !== 'idle') return;
        if (figuresCurrencyAccepted(settings.data, currency)) return;
        void queryClient.invalidateQueries({queryKey: reportingCurrencyQueryKey});
      }),
    [queryClient],
  );
}
