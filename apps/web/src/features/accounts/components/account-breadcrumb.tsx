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

type AccountBreadcrumbProps = {
  account?: Account;
  bankStatements?: boolean;
  bankStatement?: BankStatement;
};

export function AccountBreadcrumb({account, bankStatements}: AccountBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to='/home'>Home</Link>
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
              <Link to={`/accounts/$accountId`} params={{accountId: account.id}}>
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
