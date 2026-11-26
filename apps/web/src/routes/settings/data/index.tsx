import {createFileRoute} from '@tanstack/react-router';

import {AccountDelete} from '@/features/settings/components/account-delete/account-delete';

export const Route = createFileRoute('/settings/data/')({
  component: AccountDelete,
});
