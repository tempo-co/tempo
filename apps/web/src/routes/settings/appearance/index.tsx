import {createFileRoute} from '@tanstack/react-router';

import {ThemeSwitcher} from '@/features/settings/components/theme-switcher';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/settings/appearance/')({
  component: SettingsAppearanceIndex,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function SettingsAppearanceIndex() {
  return (
    <>
      <div className='w-full'>
        <h1 className='mb-6 text-2xl font-medium'>Appearance</h1>
      </div>
      <div>
        <div className='mb-4'>
          <h2 className='mb-1 text-lg font-medium'>Theme</h2>
          <p className='mr-8 text-sm text-muted-foreground'>
            Choose the appearance of the application.
          </p>
        </div>
        <ThemeSwitcher />
      </div>
    </>
  );
}
