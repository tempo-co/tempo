import {Link, Outlet, createFileRoute, useLocation} from '@tanstack/react-router';
import {ChevronLeft} from 'lucide-react';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {SettingsSectionNav} from '@/features/settings/components/settings-nav';
import {settingsSectionAt} from '@/features/settings/sections';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

/**
 * Desktop: the title over the section list and the open section. Phones: the list alone, or one section under a way
 * back to it.
 */
function SettingsLayout() {
  // The location being opened, which Link also marks: matchRoute keeps the previous section until the next one loads.
  const section = useLocation({select: (location) => settingsSectionAt(location.pathname)});
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <AppBodyLayout>
        {section ? (
          <>
            {/* Overhangs the title's row above it, so the title sits close to where every page's does. */}
            <Link
              to='/settings'
              data-testid='settings-back'
              className='-mt-2.5 -ml-2.5 flex h-11 w-fit items-center gap-1 rounded-md pr-2.5 pl-1.5 text-body text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'
            >
              <ChevronLeft className='size-4' aria-hidden='true' />
              Settings
            </Link>
            <h1 className='text-page-title'>{section.label}</h1>
          </>
        ) : (
          <h1 className='text-page-title'>Settings</h1>
        )}
        <div className='mt-6'>
          <Outlet />
        </div>
      </AppBodyLayout>
    );
  }

  return (
    <AppBodyLayout>
      <h1 className='text-page-title'>Settings</h1>
      <div className='mt-6 grid grid-cols-[--spacing(52)_minmax(0,--spacing(160))] items-start gap-8 max-lg:grid-cols-[--spacing(44)_minmax(0,1fr)] max-lg:gap-6'>
        <SettingsSectionNav current={section} />
        <div>
          {section && <h2 className='mb-4 text-section-title'>{section.label}</h2>}
          <Outlet />
        </div>
      </div>
    </AppBodyLayout>
  );
}
