import {createFileRoute, useCanGoBack, useRouter} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {MERCHANT_GROUP_ID_PATTERN} from '@tempo/contracts';
import {useCallback} from 'react';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {recurringSeriesKeySchema} from '@/features/banking/types/bank-transaction';
import {HomeDashboard} from '@/features/dashboard/components/home-dashboard';
import {MerchantsDialog} from '@/features/dashboard/components/merchants-dialog';
import {RecurringDialog} from '@/features/dashboard/components/recurring-dialog';
import {MONTH_PATTERN, currentMonth} from '@/features/dashboard/utils/month';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const homeSearchSchema = z.object({
  month: z.string().regex(MONTH_PATTERN).optional().catch(undefined),
  /** The recurring payments dialog is open; in the URL so Back closes it. */
  recurring: z.literal('open').optional().catch(undefined),
  /** The recurring payment whose details are open, so Back from one of its payments returns to it. */
  series: recurringSeriesKeySchema.optional().catch(undefined),
  /** The merchants dialog is open; in the URL so Back closes it. */
  merchants: z.literal('open').optional().catch(undefined),
  /** The merchant whose details are open, so a link can open them and Back from a payment returns. */
  merchant: z.string().regex(new RegExp(MERCHANT_GROUP_ID_PATTERN)).optional().catch(undefined),
});

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(homeSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Index() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const thisMonth = currentMonth();
  // Future months have no data yet, so they show the current month.
  const month = search.month && search.month < thisMonth ? search.month : thisMonth;
  // Replace rather than push, so closing the dialog still steps back over one entry.
  const selectSeries = useCallback(
    (series: string | null) =>
      void navigate({replace: true, search: (prev) => ({...prev, series: series ?? undefined})}),
    [navigate],
  );
  const selectMerchant = useCallback(
    (merchant: string | null) =>
      void navigate({
        replace: true,
        search: (prev) => ({...prev, merchant: merchant ?? undefined}),
      }),
    [navigate],
  );
  // Opened from Home: step back over that entry. Opened from a link: there is nothing to step back to.
  const closeDialog = (
    keys: Partial<Record<'recurring' | 'series' | 'merchants' | 'merchant', undefined>>,
  ) => {
    if (canGoBack) router.history.back();
    else void navigate({replace: true, search: (prev) => ({...prev, ...keys})});
  };

  return (
    <AppBodyLayout>
      <HomeDashboard month={month} isCurrentMonth={month === thisMonth} />
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
        month={month}
        selectedId={search.merchant ?? null}
        onSelect={selectMerchant}
        onOpenChange={(open) => {
          if (!open) closeDialog({merchants: undefined, merchant: undefined});
        }}
      />
    </AppBodyLayout>
  );
}
