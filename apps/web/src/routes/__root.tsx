import {Outlet, createRootRouteWithContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {AppHeader} from '@/components/shared/layout/app-header';
import {AppTabBar} from '@/components/shared/layout/app-nav';

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
      <AppHeader />
      {/* Reserves the tab bar's 3.5rem row plus its 1px top border. */}
      <main className='min-w-0 max-md:pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))]'>
        <Outlet />
      </main>
      <AppTabBar />
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </>
  );
}
