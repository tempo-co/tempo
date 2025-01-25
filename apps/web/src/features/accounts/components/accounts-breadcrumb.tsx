import {Link} from '@tanstack/react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {Account} from '@/types/account';
import {BankStatement} from '@/types/bank-statement';

type AccountsBreadcrumbProps = {
  account?: Account;
  bankStatements?: boolean;
  bankStatement?: BankStatement;
};

export function AccountsBreadcrumb({account, bankStatements}: AccountsBreadcrumbProps) {
  return (
    <Breadcrumb className='pb-5'>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to='/dashboard'>Dashboard</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        {account ? (
          <BreadcrumbLink asChild>
            <Link to='/accounts'>Accounts</Link>
          </BreadcrumbLink>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage>Accounts</BreadcrumbPage>
          </BreadcrumbItem>
        )}
        {account && !bankStatements && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{account.alias ? account.alias : account.bank}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
        {account && bankStatements && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbLink asChild>
              <Link to={`/accounts/${account.id}`}>
                {account.alias ? account.alias : account.bank}
              </Link>
            </BreadcrumbLink>
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
