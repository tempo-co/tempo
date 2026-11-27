import {createFileRoute} from '@tanstack/react-router';

import {InstallButton} from '@/features/install/components/install-button';
import {useInstallWay} from '@/features/install/use-install';
import {
  SettingsGroup,
  SettingsList,
  SettingsRow,
} from '@/features/settings/components/settings-group';
import {ThemeSwitcher} from '@/features/settings/components/theme-switcher';

export const Route = createFileRoute('/settings/appearance/')({
  component: SettingsAppearanceIndex,
});

function SettingsAppearanceIndex() {
  const installWay = useInstallWay();
  return (
    <div className='space-y-3'>
      <SettingsGroup
        id='theme-heading'
        title='Theme'
        description='System follows your device’s light or dark setting.'
      >
        <ThemeSwitcher />
      </SettingsGroup>
      {/* Shown where this device can install Tempo and it does not run installed already. */}
      {(installWay === 'steps' || installWay === 'prompt') && (
        <SettingsGroup id='install-heading' title='App'>
          <SettingsList>
            <SettingsRow
              label='Install Tempo'
              value='Opens full screen from its own icon, like an app.'
              action={
                <InstallButton way={installWay} variant='outline' size='sm'>
                  Install
                </InstallButton>
              }
            />
          </SettingsList>
        </SettingsGroup>
      )}
    </div>
  );
}
