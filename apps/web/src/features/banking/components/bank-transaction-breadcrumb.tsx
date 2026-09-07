import {Link} from '@tanstack/react-router';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import {BankTransaction} from '../types/bank-transaction';

type BankTransactionBreadcrumbProps = {
  transaction?: BankTransaction;
};

export function BankTransactionBreadcrumb({transaction}: BankTransactionBreadcrumbProps) {
  const label = transaction?.description || transaction?.counterpartyName || 'Transaction';

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
              <Link to='/bank-transactions'>Bank Transactions</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>Bank Transactions</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {transaction && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{label}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
