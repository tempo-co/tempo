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

type AccountsBreadcrumbProps = {
  account?: Account;
};

export function AccountsBreadcrumb({account}: AccountsBreadcrumbProps) {
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
        {account && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{account.alias ? account.alias : account.bank}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
