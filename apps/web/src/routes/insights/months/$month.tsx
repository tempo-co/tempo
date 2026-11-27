import {createFileRoute, redirect} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {MONTH_PATTERN} from '@/features/dashboard/utils/month';
import {MonthPage} from '@/features/insights/components/month-page';
import {insightsPeriodSearchSchema} from '@/features/insights/types/insights-search';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/insights/months/$month')({
  component: Month,
  validateSearch: zodValidator(insightsPeriodSearchSchema),
  beforeLoad: ({context, params, search}) => {
    handleAuthenticatedRedirect(context);
    // An address that names no month opens Insights over the same period.
    if (!MONTH_PATTERN.test(params.month)) throw redirect({to: '/insights', search, replace: true});
  },
});

function Month() {
  const {month} = Route.useParams();
  const search = Route.useSearch();
  return <MonthPage month={month} search={search} />;
}
