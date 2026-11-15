import {createFileRoute, useCanGoBack, useRouter} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useCallback} from 'react';
import {z} from 'zod';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {TooltipProvider} from '@/components/ui/tooltip';
import {HomeDashboard} from '@/features/dashboard/components/home-dashboard';
import {MonthDialog} from '@/features/dashboard/components/month-dialog';
import {MONTH_PATTERN} from '@/features/dashboard/utils/month';
import {useLocalDate} from '@/hooks/use-local-date';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

const homeSearchSchema = z.object({
  /** The month open over Home; in the URL so Back closes it. */
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
  const navigate = Route.useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const today = useLocalDate();
  const thisMonth = today.slice(0, 7);
  // A future month has no history yet, so it opens nothing.
  const month = search.month && search.month <= thisMonth ? search.month : null;
  const openMonth = useCallback(
    (next: string) => void navigate({search: (prev) => ({...prev, month: next})}),
    [navigate],
  );
  // Stepping replaces the entry, so Back still closes the month in one step.
  const stepMonth = useCallback(
    (next: string) => void navigate({replace: true, search: (prev) => ({...prev, month: next})}),
    [navigate],
  );
  // Opened from Home: step back over that entry. Opened from a link: there is nothing to step back to.
  const closeMonth = () => {
    if (canGoBack) router.history.back();
    else void navigate({replace: true, search: (prev) => ({...prev, month: undefined})});
  };

  return (
    // One provider for Home and its month, so moving between figures shows the next tip without a new delay.
    <TooltipProvider delayDuration={300}>
      <AppBodyLayout>
        <HomeDashboard today={today} onOpenMonth={openMonth} />
        <MonthDialog
          month={month}
          today={today}
          onStep={stepMonth}
          onOpenChange={(open) => {
            if (!open) closeMonth();
          }}
        />
      </AppBodyLayout>
    </TooltipProvider>
  );
}
