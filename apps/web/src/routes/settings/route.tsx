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
  {label: 'Account', route: '/settings/account', icon: User},
  {label: 'Security & access', route: '/settings/security', icon: Shield},
  {label: 'Appearance', route: '/settings/appearance', icon: SunMoon},
];

function SettingsIndex() {
  const matchRoute = useMatchRoute();

  return (
    <>
      <AppHeaderLayout>
        <SettingsBreadcrumb route='/account' />
      </AppHeaderLayout>
      <AppBodyLayout>
        <div className='mt-4 flex w-full flex-row gap-1 px-4 md:w-auto md:items-start xl:hidden'>
          {navItems.map((item) => {
            const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
            return (
              <Button key={item.label} variant='ghost' size='sm' asChild className='flex-1'>
                <Link to={item.route} className={cn(isActive && 'bg-sidebar-accent')}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </Button>
            );
          })}
        </div>
        <div className='relative mx-auto mt-4 w-full max-w-[40rem] px-4 xl:mt-20'>
          <div className='absolute right-full top-0 mr-6 hidden h-full xl:flex xl:w-[11rem] xl:flex-col xl:gap-1'>
            {navItems.map((item) => {
              const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
              return (
                <Button
                  key={item.label}
                  className='h-fit w-full px-3 py-2'
                  variant='ghost'
                  size='lg'
                  asChild
                >
                  <Link
                    to={item.route}
                    className={cn('flex flex-row !justify-start', isActive && 'bg-sidebar-accent')}
                  >
                    <item.icon className='mr-2' />
                    <span>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </div>
          <div className='mt-10 xl:mt-0'>
            <Outlet />
          </div>
        </div>
      </AppBodyLayout>
    </>
  );
}
