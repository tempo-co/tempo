import {Outlet, createFileRoute} from '@tanstack/react-router';

export const Route = createFileRoute(
  '/(accounts)/(statements)/accounts_/$accountId/bank-statements',
)({
  component: BankStatements,
});

function BankStatements() {
  return <Outlet />;
}
