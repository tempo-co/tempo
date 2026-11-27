import {createFileRoute} from '@tanstack/react-router';
import {zodValidator} from '@tanstack/zod-adapter';

import {CategoryPage} from '@/features/insights/components/category-page';
import {insightsPeriodSearchSchema} from '@/features/insights/types/insights-search';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/insights/categories/$category')({
  component: Category,
  validateSearch: zodValidator(insightsPeriodSearchSchema),
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Category() {
  const {category} = Route.useParams();
  const search = Route.useSearch();
  return <CategoryPage category={category} search={search} />;
}
