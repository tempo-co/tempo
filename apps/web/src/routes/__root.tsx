import {
  Outlet,
  type ParsedLocation,
  createRootRouteWithContext,
  redirect,
} from '@tanstack/react-router';
import {TanStackRouterDevtools} from '@tanstack/router-devtools';

import {AppPhoneHeader, AppSidebar, AppTabBar} from '@/components/shared/layout/app-nav';
import {OfflineStatus} from '@/components/shared/offline-status';
import {SidebarInset, SidebarProvider} from '@/components/ui/sidebar';
import {DeviceAlerts} from '@/features/notifications/components/device-alerts';

export const Route = createRootRouteWithContext<{
  isAuthenticated: boolean;
  isEmailVerified: boolean;
}>()({
  component: Root,
  beforeLoad: ({location}) => openRetiredDialogLinks(location),
});

/**
 * Links that open a merchant (`?merchants=open`, `?merchant=`) or a recurring series (`?recurring=open`, `?series=`)
 * over any page land on Insights or Recurring, with that merchant or series open.
 */
function openRetiredDialogLinks({pathname, search}: ParsedLocation) {
  const {recurring, series, merchants, merchant} = search as Record<string, unknown>;
  const page = pathname.replace(/\/$/, '');
  if (page !== '/recurring' && (recurring === 'open' || typeof series === 'string'))
    throw redirect({
      to: '/recurring',
      search: typeof series === 'string' ? {series} : {},
      replace: true,
    });
  if (page !== '/insights' && (merchants === 'open' || typeof merchant === 'string'))
    throw redirect({
      to: '/insights',
      search: typeof merchant === 'string' ? {merchant} : {},
      replace: true,
    });
}

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
      <DeviceAlerts />
      {import.meta.env.DEV && <TanStackRouterDevtools position='bottom-right' />}
    </SidebarProvider>
  );
}
