import {createFileRoute} from '@tanstack/react-router';

import {HomePage} from '@/features/home/components/home-page';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/')({
  component: HomePage,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});
