import {createFileRoute, redirect} from '@tanstack/react-router';

import {SideBar} from '@/components/shared/sidebar';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
  beforeLoad: ({context, location}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function Dashboard() {
  return (
    <div className='flex'>
      <SideBar />
      <p>Dashboard</p>
    </div>
  );
}
