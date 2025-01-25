import {createFileRoute} from '@tanstack/react-router';

import {AccountDetails} from '@/features/accounts/components/account-details';

export const Route = createFileRoute('/(accounts)/accounts/$accountId')({
  component: Account,
});

function Account() {
  return <AccountDetails />;
}
