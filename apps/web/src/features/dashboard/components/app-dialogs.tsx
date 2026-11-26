import {useCanGoBack, useNavigate, useRouter, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

import {TooltipProvider} from '@/components/ui/tooltip';
import {RecurringDialog} from '@/features/dashboard/components/recurring-dialog';
import type {AppDialogsSearch} from '@/features/dashboard/types/app-dialogs-search';
import {
  moneyFiguresReady,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';

/** The recurring dialog, over whichever page opened it. */
export function AppDialogs() {
  const search = useSearch({from: '__root__'});
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  // A link to the list waits while the owner still has to choose a currency or its amounts are converted.
  const ready = moneyFiguresReady(useReportingCurrency());
  // Replace rather than push, so closing the dialog still steps back over one entry.
  const selectSeries = useCallback(
    (series: string | null) =>
      void navigate({
        to: '.',
        replace: true,
        search: (prev) => ({...prev, series: series ?? undefined}),
      }),
    [navigate],
  );
  // Opened from a page: step back over that entry. Opened from a link: there is nothing to step back to.
  const closeDialog = (keys: Partial<Record<keyof AppDialogsSearch, undefined>>) => {
    if (canGoBack) router.history.back();
    else void navigate({to: '.', replace: true, search: (prev) => ({...prev, ...keys})});
  };

  return (
    // One provider for the dialog, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <RecurringDialog
        open={ready && search.recurring === 'open'}
        selectedKey={search.series ?? null}
        onSelect={selectSeries}
        onOpenChange={(open) => {
          if (!open) closeDialog({recurring: undefined, series: undefined});
        }}
      />
    </TooltipProvider>
  );
}
