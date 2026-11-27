import {createFileRoute} from '@tanstack/react-router';

import {ReportsPage} from '@/features/dashboard/components/reports-page';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/')({
  component: ReportsPage,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});
