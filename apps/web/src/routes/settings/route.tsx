import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router';
import {Shield, SunMoon, User} from 'lucide-react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {Button} from '@/components/ui/button';
import {SettingsBreadcrumb} from '@/features/settings/components/settings-breadcrumb';
import {cn} from '@/utils/cn';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings')({
  component: SettingsIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

const navItems = [
  {label: 'Account', route: '/settings/account', breadcrumb: '/account', icon: User},
  {label: 'Security', route: '/settings/security', breadcrumb: '/security', icon: Shield},
  {label: 'Appearance', route: '/settings/appearance', breadcrumb: '/appearance', icon: SunMoon},
] as const;

function SettingsIndex() {
  const matchRoute = useMatchRoute();
  const activeNavItem = navItems.find((item) => matchRoute({to: item.route, fuzzy: true}));

  return (
    <>
      <AppHeaderLayout>
        <SettingsBreadcrumb route={activeNavItem?.breadcrumb ?? '/account'} />
      </AppHeaderLayout>
      <AppBodyLayout>
        <nav aria-label='Settings sections' className='mx-auto max-w-[40rem] xl:hidden'>
          <div className='mt-4 flex w-full gap-1 rounded-lg border bg-muted/60 p-1'>
            {navItems.map((item) => {
              const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
              return (
                <Button
                  key={item.label}
                  variant='ghost'
                  size='default'
                  asChild
                  className={cn(
                    'min-h-11 min-w-0 flex-1 px-2 text-xs sm:px-3 sm:text-sm',
                    isActive && 'bg-card font-medium shadow-sm',
                  )}
                >
                  <Link
                    to={item.route}
                    aria-current={isActive ? 'page' : undefined}
                    className='min-w-0'
                  >
                    <item.icon />
                    <span className='truncate'>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </div>
        </nav>
        <div className='relative mx-auto mt-8 w-full max-w-[40rem] xl:mt-12'>
          <nav
            aria-label='Settings sections'
            className='absolute right-full top-0 mr-8 hidden h-full xl:flex xl:w-[11rem] xl:flex-col xl:gap-1'
          >
            {navItems.map((item) => {
              const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
              return (
                <Button
                  key={item.label}
                  className={cn('h-11 w-full px-3', isActive && 'bg-sidebar-accent font-medium')}
                  variant='ghost'
                  size='lg'
                  asChild
                >
                  <Link
                    to={item.route}
                    aria-current={isActive ? 'page' : undefined}
                    className='flex flex-row !justify-start'
                  >
                    <item.icon className='mr-2' />
                    <span>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </nav>
          <div className='mt-6 xl:mt-0'>
            <Outlet />
          </div>
        </div>
      </AppBodyLayout>
    </>
  );
}
