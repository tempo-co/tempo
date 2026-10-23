import {createFileRoute} from '@tanstack/react-router';

import {AccessTokenSettings} from '@/features/settings/components/access-tokens/access-token-settings';

export const Route = createFileRoute('/settings/integrations/')({
  component: AccessTokenSettings,
});
