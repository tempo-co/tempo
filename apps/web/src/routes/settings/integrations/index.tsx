import {createFileRoute} from '@tanstack/react-router';

import {AccessTokenSettings} from '@/features/settings/components/access-tokens/access-token-settings';
import {McpConnectionSettings} from '@/features/settings/components/access-tokens/mcp-connection-settings';

export const Route = createFileRoute('/settings/integrations/')({
  component: IntegrationsSettings,
});

function IntegrationsSettings() {
  return (
    <div className='space-y-8'>
      <AccessTokenSettings />
      <McpConnectionSettings />
    </div>
  );
}
