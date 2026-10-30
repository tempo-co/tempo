import {createFileRoute} from '@tanstack/react-router';

import {SettingsGroup} from '@/features/settings/components/settings-group';
import {ThemeSwitcher} from '@/features/settings/components/theme-switcher';

export const Route = createFileRoute('/settings/appearance/')({
  component: SettingsAppearanceIndex,
});

function SettingsAppearanceIndex() {
  return (
    <SettingsGroup
      id='theme-heading'
      title='Theme'
      description='System follows your device’s light or dark setting.'
    >
      <ThemeSwitcher />
    </SettingsGroup>
  );
}
