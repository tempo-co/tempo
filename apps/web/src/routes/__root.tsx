import {Outlet, createRootRouteWithContext, useRouteContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {AppSidebar} from '@/components/shared/layout/app-sidebar';
import {SidebarProvider} from '@/components/ui/sidebar';
import {User} from '@/types/user';

export const Route = createRootRouteWithContext<{isAuthenticated: boolean; currentUser: User}>()({
  component: Root,
});

function Root() {
  const {isAuthenticated, currentUser} = useRouteContext({from: '__root__'});

  if (!isAuthenticated) {
    return (
      <>
        <main>
          <Outlet />
        </main>
        {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
      </>
    );
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar user={currentUser} />
        <main className='flex-1'>
          <Outlet />
        </main>
      </SidebarProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </>
  );
}
