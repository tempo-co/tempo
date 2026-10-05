import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {HomeDashboard} from '@/features/dashboard/components/home-dashboard';
import {MONTH_PATTERN, currentMonth} from '@/features/dashboard/utils/month';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const homeSearchSchema = z.object({
  month: z.string().regex(MONTH_PATTERN).optional().catch(undefined),
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
  const thisMonth = currentMonth();
  // Future months have no data yet, so they show the current month.
  const month = search.month && search.month < thisMonth ? search.month : thisMonth;

  return (
    <>
      <AppHeaderLayout>
        <span className='text-sm font-medium'>Home</span>
      </AppHeaderLayout>
      <AppBodyLayout>
        <HomeDashboard month={month} isCurrentMonth={month === thisMonth} />
      </AppBodyLayout>
    </>
  );
}
