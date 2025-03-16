import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router';
import {Shield, SunMoon, User} from 'lucide-react';

import {AppBody} from '@/components/shared/layout/app-body';
import {AppHeader} from '@/components/shared/layout/app-header';
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
  {label: 'Security', route: '/settings/security', icon: Shield},
  {label: 'Theme', route: '/settings/theme', icon: SunMoon},
];

function SettingsIndex() {
  const matchRoute = useMatchRoute();

  return (
    <>
      <AppHeader>
        <SettingsBreadcrumb route='/account' />
      </AppHeader>
      <AppBody>
        <div className='mt-4 flex flex-col gap-4 xl:flex-row'>
          <div className='flex w-full flex-row gap-1 md:w-auto md:items-start xl:flex-col'>
            {navItems.map((item) => {
              const isActive = matchRoute({to: item.route, fuzzy: true}) as boolean;
              return (
                <Button
                  key={item.label}
                  className='h-fit flex-1 p-3 md:w-32 md:flex-none'
                  variant='ghost'
                  size='lg'
                  asChild
                >
                  <Link
                    to={item.route}
                    className={cn(
                      'flex items-center justify-center md:flex-row md:!justify-start',
                      isActive && 'bg-sidebar-accent',
                    )}
                  >
                    <item.icon className='mb-1 md:mb-0 md:mr-2' />
                    <span>{item.label}</span>
                  </Link>
                </Button>
              );
            })}
          </div>
          <div className='w-full'>
            <Outlet />
          </div>
        </div>
      </AppBody>
    </>
  );
}
