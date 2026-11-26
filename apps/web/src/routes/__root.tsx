import {Outlet, createRootRouteWithContext} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';
import {zodValidator} from '@tanstack/zod-adapter';
import {Suspense, lazy, useState} from 'react';

import {AppPhoneHeader, AppSidebar, AppTabBar} from '@/components/shared/layout/app-nav';
import {OfflineStatus} from '@/components/shared/offline-status';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {appDialogsSearchSchema} from '@/features/dashboard/types/app-dialogs-search';
import {DeviceAlerts} from '@/features/notifications/components/device-alerts';

export const Route = createRootRouteWithContext<{
  isAuthenticated: boolean;
  isEmailVerified: boolean;
}>()({
  component: Root,
  validateSearch: zodValidator(appDialogsSearchSchema),
});

// The dialog draws charts, so it and the chart library load only once a page opens it.
const AppDialogs = lazy(() =>
  import('@/features/dashboard/components/app-dialogs').then((module) => ({
    default: module.AppDialogs,
  })),
);

/** Mounts the dialog from the first time it is asked for, then keeps it, so it can animate closed. */
function useDialogsWanted() {
  const {recurring} = Route.useSearch();
  const asked = recurring === 'open';
  const [wanted, setWanted] = useState(asked);
  if (asked && !wanted) setWanted(true);
  return wanted;
}

function Root() {
  const {isAuthenticated, isEmailVerified} = Route.useRouteContext();
  const dialogsWanted = useDialogsWanted();

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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <AppPhoneHeader />
        {/* Desktop has no header, so the offline label sits above the column's top-right corner. */}
        <div className='absolute top-2 right-4 z-10 max-md:hidden'>
          <OfflineStatus />
        </div>
        {/* Reserves the tab bar's 3.5rem row plus its 1px top border. */}
        <main className='min-w-0 max-md:pb-[calc(--spacing(14)+1px+env(safe-area-inset-bottom))]'>
          <Outlet />
        </main>
      </SidebarInset>
      <AppTabBar />
      {dialogsWanted && (
        <Suspense fallback={null}>
          <AppDialogs />
        </Suspense>
      )}
      <DeviceAlerts />
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </SidebarProvider>
  );
}
