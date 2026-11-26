import {createFileRoute, useNavigate, useSearch} from '@tanstack/react-router';
import {useCallback} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {TooltipProvider} from '@/components/ui/tooltip';
import {RecurringSeriesOverview} from '@/features/banking/components/recurring-series-overview';
import {
  moneyFiguresReady,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

/** Every recurring bill and income stream, as a page; the open series is the `series` key in the URL. */
export const Route = createFileRoute('/recurring/')({
  component: Recurring,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Recurring() {
  const {series} = useSearch({from: '__root__'});
  const navigate = useNavigate();
  const asOf = useLocalDate();
  // The list waits while the owner still has to choose a currency or its amounts are converted.
  const ready = moneyFiguresReady(useReportingCurrency());
  // Replace rather than push, so Back leaves the page instead of stepping through series.
  const select = useCallback(
    (key: string | null) =>
      void navigate({
        to: '.',
        replace: true,
        search: (prev) => ({...prev, series: key ?? undefined}),
      }),
    [navigate],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        <h1 className='mb-5 text-page-title max-md:mb-4'>Recurring</h1>
        {ready && (
          <RecurringSeriesOverview asOf={asOf} selectedKey={series ?? null} onSelect={select} />
        )}
      </AppBodyLayout>
    </TooltipProvider>
  );
}
