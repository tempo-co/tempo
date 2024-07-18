import {createFileRoute} from '@tanstack/react-router';

import {BankStatementsList} from '@/features/bank-statements/components/bank-statements-list';

export const Route = createFileRoute(
  '/(accounts)/(statements)/accounts/$accountId/bank-statements/',
)({
  component: BankStatementsIndex,
});

function BankStatementsIndex() {
  return <BankStatementsList />;
}
