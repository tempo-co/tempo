import {useNavigate} from '@tanstack/react-router';
import {useCallback} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {TooltipProvider} from '@/components/ui/tooltip';
import {
  reportingCurrencyKnown,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';

import {HomeDashboard} from './home-dashboard';

/** The history reports (where you stand, year by year, spending and income by year); a month opens its own page. */
export function ReportsPage() {
  const navigate = useNavigate();
  const today = useLocalDate();
  const reporting = useReportingCurrency();
  const openMonth = useCallback(
    (month: string) => void navigate({to: '/insights/months/$month', params: {month}}),
    [navigate],
  );

  return (
    // One provider for the page, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        {/* The page loads once it is known whether its figures may be added up at all. */}
        {reportingCurrencyKnown(reporting) && (
          <HomeDashboard today={today} onOpenMonth={openMonth} />
        )}
      </AppBodyLayout>
    </TooltipProvider>
  );
}
