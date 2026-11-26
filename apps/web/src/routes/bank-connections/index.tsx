import {createFileRoute, redirect} from '@tanstack/react-router';

/** Connections became Accounts. Emails, push alerts and saved bookmarks still open it, with their query. */
export const Route = createFileRoute('/bank-connections/')({
  beforeLoad: ({search}) => {
    throw redirect({to: '/accounts', search: search as never, replace: true});
  },
});
