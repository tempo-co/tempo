import {Link} from '@tanstack/react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {Transaction} from '@/types/transaction';

type TransactionBreadcrumb = {
  transaction?: Transaction;
};

export function TransactionBreadcrumb({transaction}: TransactionBreadcrumb) {
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
          {transaction ? (
            <BreadcrumbLink asChild>
              <Link to='/transactions'>Transactions</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Transactions</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {transaction && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{transaction.description}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
