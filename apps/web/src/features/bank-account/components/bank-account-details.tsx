import {Link} from '@tanstack/react-router';

import {Button} from '@/components/ui/button';
import {BankAccount} from '@/types/bank-account';

type BankAccountDetailsProps = {
  bankAccount: BankAccount;
};

export function BankAccountDetails({bankAccount}: BankAccountDetailsProps) {
  return (
    <>
      <h1>Bank account Details</h1>
      <p>{bankAccount.bank}</p>
      <p>{bankAccount.id}</p>
      <Button asChild>
        <Link
          to='/bank-accounts/$bankAccountId/bank-statements'
          params={{bankAccountId: bankAccount.id}}
        >
          Statements
        </Link>
      </Button>
    </>
  );
}
