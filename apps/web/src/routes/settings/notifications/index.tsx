import {createFileRoute} from '@tanstack/react-router';

import {NotificationSettings} from '@/features/notifications/components/notification-settings';

export const Route = createFileRoute('/settings/notifications/')({
  component: NotificationSettings,
});
