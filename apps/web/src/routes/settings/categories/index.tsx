import {createFileRoute} from '@tanstack/react-router';

import {CategoryCounts} from '@/features/settings/components/category-counts';

export const Route = createFileRoute('/settings/categories/')({
  component: CategoryCounts,
});
