import {Outlet, createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/(accounts)/accounts')({
  component: Accounts,
  beforeLoad: ({context}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login'});
    }
  },
});

function Accounts() {
  return (
    <div className='p-10'>
      <Outlet />
    </div>
  );
}
