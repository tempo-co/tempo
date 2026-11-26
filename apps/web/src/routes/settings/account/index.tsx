import {createFileRoute, redirect} from '@tanstack/react-router';

/** Account's earlier address: its rows now live in Profile, Notifications and Your data. */
export const Route = createFileRoute('/settings/account/')({
  beforeLoad: () => {
    throw redirect({to: '/settings/profile', replace: true});
  },
});
