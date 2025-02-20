import {Outlet, createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/(transactions)/transactions')({
  component: Transactions,
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function Transactions() {
  return <Outlet />;
}
