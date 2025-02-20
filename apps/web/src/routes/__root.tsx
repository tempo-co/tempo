import {Outlet, createRootRouteWithContext, useRouteContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {AppSidebar} from '@/components/shared/app-sidebar';
import {SidebarProvider, SidebarTrigger} from '@/components/ui/sidebar';
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
        <main>
          <SidebarTrigger />
          <Outlet />
        </main>
      </SidebarProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </>
  );
}
