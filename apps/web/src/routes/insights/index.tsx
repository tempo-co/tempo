import {createFileRoute, useNavigate} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';
import {useMemo} from 'react';

import {type InsightsNavigation, InsightsPage} from '@/features/insights/components/insights-page';
import {insightsSearchSchema} from '@/features/insights/types/insights-search';
import {periodSearch} from '@/features/insights/utils/insights-links';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';
import {pageHead} from '@/utils/page-title';

export const Route = createFileRoute('/insights/')({
  head: pageHead('Insights'),
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
        void navigate({search: (prev) => ({...prev, period: periodSearch(period).period})}),
      setSearch: (next) => void navigate({replace: true, search: (prev) => ({...prev, ...next})}),
    }),
    [navigate],
  );
  return <InsightsPage search={search} navigation={navigation} />;
}
