import {createFileRoute, useCanGoBack, useRouter} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {HomeDashboard} from '@/features/dashboard/components/home-dashboard';
import {RecurringDialog} from '@/features/dashboard/components/recurring-dialog';
import {MONTH_PATTERN, currentMonth} from '@/features/dashboard/utils/month';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const homeSearchSchema = z.object({
  month: z.string().regex(MONTH_PATTERN).optional().catch(undefined),
  /** The recurring payments dialog is open; in the URL so Back closes it. */
  recurring: z.literal('open').optional().catch(undefined),
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

  return (
    <AppBodyLayout>
      <HomeDashboard month={month} isCurrentMonth={month === thisMonth} />
      <RecurringDialog
        open={search.recurring === 'open'}
        onOpenChange={(open) => {
          if (open) return;
          // Opened from Home: step back over that entry. Opened from a link: there is nothing to step back to.
          if (canGoBack) router.history.back();
          else void navigate({replace: true, search: (prev) => ({...prev, recurring: undefined})});
        }}
      />
    </AppBodyLayout>
  );
}
