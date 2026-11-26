import {useCanGoBack, useNavigate, useRouter, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

import {TooltipProvider} from '@/components/ui/tooltip';
import {MerchantsDialog} from '@/features/dashboard/components/merchants-dialog';
import type {AppDialogsSearch} from '@/features/dashboard/types/app-dialogs-search';
import {
  moneyFiguresReady,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';

/** The merchants dialog, over whichever page opened it. */
export function AppDialogs() {
  const search = useSearch({from: '__root__'});
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const thisMonth = useLocalDate().slice(0, 7);
  // A link to a list waits while the owner still has to choose a currency or its amounts are converted.
  const ready = moneyFiguresReady(useReportingCurrency());
  // Replace rather than push, so closing the dialog still steps back over one entry.
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
    // One provider for the dialog's figures, so moving between them shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <MerchantsDialog
        open={ready && search.merchants === 'open'}
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
