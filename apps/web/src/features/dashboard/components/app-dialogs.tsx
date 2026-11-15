import {useCanGoBack, useNavigate, useRouter, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

import {TooltipProvider} from '@/components/ui/tooltip';
import {MerchantsDialog} from '@/features/dashboard/components/merchants-dialog';
import {RecurringDialog} from '@/features/dashboard/components/recurring-dialog';
import type {AppDialogsSearch} from '@/features/dashboard/types/app-dialogs-search';
import {useLocalDate} from '@/hooks/use-local-date';

/** The recurring and merchants dialogs, over whichever page opened them. */
export function AppDialogs() {
  const search = useSearch({from: '__root__'});
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const thisMonth = useLocalDate().slice(0, 7);
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
  const selectMerchant = useCallback(
    (merchant: string | null) =>
      void navigate({
        to: '.',
        replace: true,
        search: (prev) => ({...prev, merchant: merchant ?? undefined}),
      }),
    [navigate],
  );
  // Opened from a page: step back over that entry. Opened from a link: there is nothing to step back to.
  const closeDialog = (keys: Partial<Record<keyof AppDialogsSearch, undefined>>) => {
    if (canGoBack) router.history.back();
    else void navigate({to: '.', replace: true, search: (prev) => ({...prev, ...keys})});
  };

  return (
    // One provider for the dialogs, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <RecurringDialog
        open={search.recurring === 'open'}
        selectedKey={search.series ?? null}
        onSelect={selectSeries}
        onOpenChange={(open) => {
          if (!open) closeDialog({recurring: undefined, series: undefined});
        }}
      />
      <MerchantsDialog
        open={search.merchants === 'open'}
        month={thisMonth}
        selectedId={search.merchant ?? null}
        onSelect={selectMerchant}
        onOpenChange={(open) => {
          if (!open) closeDialog({merchants: undefined, merchant: undefined});
        }}
      />
    </TooltipProvider>
  );
}
