import {Link} from '@tanstack/react-router';
import {ChevronLeft} from 'lucide-react';

import type {InsightsPeriodSearch} from '../types/insights-search';

/** The way back from a category or a month to Insights over the same period. */
export function InsightsBackLink({search}: {search: InsightsPeriodSearch}) {
  return (
    // Overhangs the title's row above it, so the title sits close to where every page's does.
    <Link
      to='/insights'
      search={search}
      className='-mt-2.5 -ml-2.5 flex h-11 w-fit items-center gap-1 rounded-md pr-2.5 pl-1.5 text-body text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
    >
      <ChevronLeft className='size-4' aria-hidden='true' />
      Insights
    </Link>
  );
}
