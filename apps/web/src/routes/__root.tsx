import {Outlet, createRootRouteWithContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {AppSidebarLayout} from '@/components/shared/layout/app-sidebar-layout';
import {SidebarProvider} from '@/components/ui/sidebar';

export const Route = createRootRouteWithContext<{
  isAuthenticated: boolean;
  isEmailVerified: boolean;
}>()({
  component: Root,
});

function Root() {
  const {isAuthenticated, isEmailVerified} = Route.useRouteContext();

  if (!isAuthenticated || !isEmailVerified) {
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
        <AppSidebarLayout />
        <main className='flex-1'>
          <Outlet />
        </main>
      </SidebarProvider>
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </>
  );
}
