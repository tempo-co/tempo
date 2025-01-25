import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/transactions')({
  component: Transactions,
  beforeLoad: ({context, location}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function Transactions() {
  return <p>Transactions</p>;
}
