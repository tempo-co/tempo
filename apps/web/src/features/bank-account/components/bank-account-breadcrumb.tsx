import {Link} from '@tanstack/react-router';

import {BankIcon} from '@/components/shared/bank-icon';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {BankAccount} from '@/types/bank-account';
import {BankStatement} from '@/types/bank-statement';

type BankAccountBreadcrumbProps = {
  bankAccount?: BankAccount;
  bankStatements?: boolean;
  bankStatement?: BankStatement;
};

export function BankAccountBreadcrumb({bankAccount, bankStatements}: BankAccountBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to='/'>Home</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {bankAccount ? (
            <BreadcrumbLink asChild>
              <Link to='/bank-accounts'>Bank accounts</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Bank accounts</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {bankAccount && !bankStatements && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className='flex items-center'>
                <div className='mr-1 rounded-md bg-muted p-[0.2rem]'>
                  <BankIcon bank={bankAccount.bank} className='h-3 w-3' />
                </div>
                {bankAccount.alias ? bankAccount.alias : bankAccount.bank}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
        {bankAccount && bankStatements && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link
                  to={`/bank-accounts/$bankAccountId`}
                  params={{bankAccountId: bankAccount.id}}
                  className='flex items-center'
                >
                  <div className='mr-1 rounded-md bg-muted p-[0.2rem]'>
                    <BankIcon bank={bankAccount.bank} className='h-3 w-3' />
                  </div>
                  {bankAccount.alias ? bankAccount.alias : bankAccount.bank}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Bank Statements</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
