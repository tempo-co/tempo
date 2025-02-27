import {Link} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {Account} from '@/types/account';

type AccountDetailsProps = {
  account: Account;
};

export function AccountDetails({account}: AccountDetailsProps) {
  return (
    <>
      <h1>Account Details</h1>
      <p>{account.bank}</p>
      <p>{account.id}</p>
      <Button asChild>
        <Link to='/accounts/$accountId/bank-statements' params={{accountId: account.id}}>
          Statements
        </Link>
      </Button>
    </>
  );
}
