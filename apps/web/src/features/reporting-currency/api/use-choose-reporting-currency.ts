import {useMutation, useQueryClient} from '@tanstack/react-query';
import type {ReportingCurrency, ReportingCurrencyUpdateRequest} from '@tempo/contracts';
import {toast} from 'sonner';

import {CURRENT_ACCOUNT_KEY} from '@/hooks/use-current-account';
import {HttpError, api, wasToasted} from '@/utils/api';

import {
  noteReportingCurrency,
  reportingCurrencyQueryKey,
  resetMoneyFigures,
} from './use-reporting-currency';

/** Saves the reporting currency. Where it was chosen shows the result, so only a failure toasts. */
export function useChooseReportingCurrency() {
  const queryClient = useQueryClient();
  const {mutateAsync, isPending} = useMutation<ReportingCurrency, HttpError, string>({
    mutationFn: (currency) =>
      api.put<ReportingCurrency>('/reporting-currency', {
        currency,
      } satisfies ReportingCurrencyUpdateRequest),
    onSuccess: async (saved) => {
      const previous = queryClient.getQueryData<ReportingCurrency>(reportingCurrencyQueryKey);
      queryClient.setQueryData(reportingCurrencyQueryKey, saved);
      // Noted here, so the readers don't drop the figures a second time. A read that cached the new currency
      // before this answer arrived leaves the cache unchanged but not yet noted, so both are checked.
      const changed = noteReportingCurrency(queryClient, saved);
      // Confirming the current currency changes no figure.
      if (!changed && previous?.currency === saved.currency) return;
      // Figures in the old currency must not stay on screen, and the account names the new one.
      await Promise.all([
        resetMoneyFigures(queryClient),
        queryClient.invalidateQueries({queryKey: CURRENT_ACCOUNT_KEY}),
      ]);
    },
  });

  const choose = async (currency: string) => {
    try {
      return await mutateAsync(currency);
    } catch (error) {
      if (!wasToasted(error)) toast.error('The currency could not be saved. Please try again.');
      throw error;
    }
  };

  return {choose, isPending};
}
