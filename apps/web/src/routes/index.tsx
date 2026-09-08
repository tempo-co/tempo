import {createFileRoute} from '@tanstack/react-router';

import {AppBodyLayout} from '@/components/shared/layout/app-body';
import {AppHeaderLayout} from '@/components/shared/layout/app-header-layout';
import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/')({
  component: Index,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Index() {
  return (
    <>
      <AppHeaderLayout>
        <span className='text-sm font-medium'>Home</span>
      </AppHeaderLayout>
      <AppBodyLayout>
        <p>index</p>
      </AppBodyLayout>
    </>
  );
}
