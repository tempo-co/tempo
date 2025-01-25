import {Outlet, createRootRouteWithContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {SideBar} from '@/components/shared/sidebar';
import {useCurrentUser} from '@/hooks/use-current-user';

export const Route = createRootRouteWithContext<{isAuthenticated: boolean}>()({
  component: Root,
});

function Root() {
  const {isAuthenticated} = useCurrentUser();

  return (
    <div className='flex h-screen overflow-hidden'>
      {isAuthenticated && <SideBar />}
      <div className='flex-1 overflow-auto'>
        <Outlet />
      </div>
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </div>
  );
}
