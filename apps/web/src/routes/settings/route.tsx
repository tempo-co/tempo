import {Link, Outlet, createFileRoute, useLocation} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {cn} from '@/utils/cn';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings')({
  component: SettingsIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

const sections = [
  {label: 'Account', route: '/settings/account'},
  {label: 'Security', route: '/settings/security'},
  {label: 'Integrations', route: '/settings/integrations'},
  {label: 'Appearance', route: '/settings/appearance'},
] as const;

function SettingsIndex() {
  // The location being opened, which Link also marks: matchRoute keeps the previous section until the next one loads.
  const pathname = useLocation({select: (location) => location.pathname});

  return (
    <AppBodyLayout>
      <div className='mx-auto w-full max-w-160'>
        <h1 className='text-page-title'>Settings</h1>
        {/* Same underline language as the header nav, one level down. */}
        <nav aria-label='Settings sections' className='mt-4 border-b'>
          {/* Phones share the full width; wider screens align the first label with the title. */}
          <ul className='-mb-px flex sm:-ml-3'>
            {sections.map((section) => {
              const isActive =
                pathname === section.route || pathname.startsWith(`${section.route}/`);
              return (
                <li key={section.route} className='max-sm:flex-auto'>
                  <Link
                    to={section.route}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative flex h-12 items-center justify-center px-1 text-sm whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-[360px]:text-[13px] sm:h-11 sm:px-3',
                      isActive &&
                        'font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary sm:after:inset-x-3',
                    )}
                  >
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className='mt-8'>
          <Outlet />
        </div>
      </div>
    </AppBodyLayout>
  );
}
