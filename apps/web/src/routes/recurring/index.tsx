import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useCallback} from 'react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {TooltipProvider} from '@/components/ui/tooltip';
import {RecurringPage} from '@/features/banking/components/recurring-page';
import {
  type RecurringSearch,
  recurringSearchSchema,
} from '@/features/banking/types/recurring-search';
import {
  moneyFiguresReady,
  useReportingCurrency,
} from '@/features/reporting-currency/api/use-reporting-currency';
import {useLocalDate} from '@/hooks/use-local-date';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

/** This month's bills and the whole catalogue; the tab, the view and the open series are in the URL. */
export const Route = createFileRoute('/recurring/')({
  component: Recurring,
  validateSearch: zodValidator(recurringSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Recurring() {
  const search = Route.useSearch();
  const navigate = useNavigate({from: '/recurring/'});
  const asOf = useLocalDate();
  // The page waits while the owner still has to choose a currency or its amounts are converted.
  const ready = moneyFiguresReady(useReportingCurrency());
  // Replace rather than push, so Back leaves the page instead of stepping through series and tabs.
  const change = useCallback(
    (next: Partial<RecurringSearch>) =>
      void navigate({replace: true, search: (prev) => ({...prev, ...next})}),
    [navigate],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        <h1 className='mb-5 text-page-title max-md:mb-4'>Recurring</h1>
        {ready && <RecurringPage asOf={asOf} search={search} onChange={change} />}
      </AppBodyLayout>
    </TooltipProvider>
  );
}
