import {Navigate, createFileRoute} from '@tanstack/react-router';

import {SettingsSectionList} from '@/features/settings/components/settings-nav';
import {useIsMobile} from '@/hooks/use-is-mobile';

export const Route = createFileRoute('/settings/')({
  component: SettingsIndex,
});

/** Desktop opens the first section; phones show the list to tap into. */
function SettingsIndex() {
  const isMobile = useIsMobile();
  if (!isMobile) return <Navigate to='/settings/profile' replace />;
  return <SettingsSectionList />;
}
