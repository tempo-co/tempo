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
    <div className='w-full'>
      <h1 className='mb-8 text-2xl font-semibold tracking-tight'>Appearance</h1>
      <section aria-labelledby='theme-heading' className='space-y-3'>
        <div className='space-y-1'>
          <h2 id='theme-heading' className='text-lg font-semibold'>
            Theme
          </h2>
          <p className='max-w-[34rem] text-sm text-muted-foreground'>
            Choose the appearance of the application.
          </p>
        </div>
        <ThemeSwitcher />
      </section>
    </div>
  );
}
