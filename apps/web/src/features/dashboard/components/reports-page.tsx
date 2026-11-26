import {useCanGoBack, useNavigate, useRouter} from '@tanstack/react-router';
import {useCallback} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {TooltipProvider} from '@/components/ui/tooltip';
import {
  moneyFiguresReady,
  reportingCurrencyKnown,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';

import {HomeDashboard} from './home-dashboard';
import {MonthDialog} from './month-dialog';

/** The history reports (where you stand, year by year, spending and income by year) with their month dialog. */
export function ReportsPage({month: searchMonth, title}: {month?: string; title?: string}) {
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const today = useLocalDate();
  const thisMonth = today.slice(0, 7);
  const reporting = useReportingCurrency();
  // The reports ask for a currency or wait for their amounts first; a link to a month or list waits with them.
  const ready = moneyFiguresReady(reporting);
  // A future month has no history yet, so it opens nothing.
  const month = ready && searchMonth && searchMonth <= thisMonth ? searchMonth : null;
  const openMonth = useCallback(
    (next: string) => void navigate({to: '.', search: (prev) => ({...prev, month: next})}),
    [navigate],
  );
  // Stepping replaces the entry, so Back still closes the month in one step.
  const stepMonth = useCallback(
    (next: string) =>
      void navigate({to: '.', replace: true, search: (prev) => ({...prev, month: next})}),
    [navigate],
  );
  // Opened from the page: step back over that entry. Opened from a link: there is nothing to step back to.
  const closeMonth = () => {
    if (canGoBack) router.history.back();
    else void navigate({to: '.', replace: true, search: (prev) => ({...prev, month: undefined})});
  };

  return (
    // One provider for the page and its month, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        {title && <h1 className='mb-5 text-page-title max-md:mb-4'>{title}</h1>}
        {/* The page and a linked month load together once it is known whether their figures may be added up at all. */}
        {reportingCurrencyKnown(reporting) && (
          <>
            <HomeDashboard today={today} onOpenMonth={openMonth} />
            <MonthDialog
              month={month}
              today={today}
              onStep={stepMonth}
              onOpenChange={(open) => {
                if (!open) closeMonth();
              }}
            />
          </>
        )}
      </AppBodyLayout>
    </TooltipProvider>
  );
}
