import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useMemo} from 'react';

import {type InsightsNavigation, InsightsPage} from '@/features/insights/components/insights-page';
import {insightsSearchSchema} from '@/features/insights/types/insights-search';
import {DEFAULT_PERIOD} from '@/features/insights/utils/insights-period';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/insights/')({
  component: Insights,
  validateSearch: zodValidator(insightsSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Insights() {
  const search = Route.useSearch();
  const navigate = useNavigate({from: Route.fullPath});
  const navigation = useMemo<InsightsNavigation>(
    () => ({
      setPeriod: (period) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            // A year goes in as a number, so the address reads `period=2025` rather than a quoted string.
            period:
              period === DEFAULT_PERIOD
                ? undefined
                : /^\d+$/.test(period)
                  ? Number(period)
                  : period,
          }),
        }),
      setSearch: (next) => void navigate({replace: true, search: (prev) => ({...prev, ...next})}),
    }),
    [navigate],
  );
  return <InsightsPage search={search} navigation={navigation} />;
}
