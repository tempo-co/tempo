import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {ReportsPage} from '@/features/dashboard/components/reports-page';
import {reportsSearchSchema} from '@/features/dashboard/types/reports-search';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

/** Until Insights gets its own page, it shows the history reports Home shows today. */
export const Route = createFileRoute('/insights/')({
  component: Insights,
  validateSearch: zodValidator(reportsSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Insights() {
  const {month} = Route.useSearch();
  return <ReportsPage month={month} title='Insights' />;
}
