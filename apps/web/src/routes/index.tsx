import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {ReportsPage} from '@/features/dashboard/components/reports-page';
import {reportsSearchSchema} from '@/features/dashboard/types/reports-search';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/')({
  component: Index,
  validateSearch: zodValidator(reportsSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Index() {
  const {month} = Route.useSearch();
  return <ReportsPage month={month} />;
}
