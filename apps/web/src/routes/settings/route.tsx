import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router';

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
  {label: 'Appearance', route: '/settings/appearance'},
  {label: 'Integrations', route: '/settings/integrations'},
] as const;

function SettingsIndex() {
  const matchRoute = useMatchRoute();

  return (
    <AppBodyLayout>
      <div className='mx-auto w-full max-w-160'>
        <h1 className='text-page-title'>Settings</h1>
        {/* Same underline language as the header nav, one level down. */}
        <nav aria-label='Settings sections' className='mt-4 border-b'>
          {/* Match the link inset so the first label aligns with the page title. */}
          <ul className='-mb-px -ml-1.5 flex sm:-ml-3'>
            {sections.map((section) => {
              const isActive = matchRoute({to: section.route, fuzzy: true}) !== false;
              return (
                <li key={section.route}>
                  <Link
                    to={section.route}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'relative flex h-11 items-center px-1.5 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-3 sm:text-sm',
                      isActive &&
                        'font-medium text-foreground after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:bg-primary sm:after:inset-x-3',
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
