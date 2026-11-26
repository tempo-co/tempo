import {createFileRoute, redirect} from '@tanstack/react-router';

/** Transactions moved to `/transactions`. Old links and bookmarks still open it, with their filters. */
export const Route = createFileRoute('/bank-transactions/')({
  beforeLoad: ({search}) => {
    throw redirect({to: '/transactions', search: search as never, replace: true});
  },
});
