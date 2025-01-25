import {createFileRoute} from '@tanstack/react-router';

import {AccountsList} from '@/features/accounts/components/accounts-list';

export const Route = createFileRoute('/(accounts)/accounts/')({
  component: AccountsIndex,
});

function AccountsIndex() {
  return <AccountsList />;
}
