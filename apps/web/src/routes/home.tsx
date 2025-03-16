import {createFileRoute} from '@tanstack/react-router';

import {handleAuthenticatedRedirect} from '@/utils/handle-redirect';

export const Route = createFileRoute('/home')({
  component: Home,
  beforeLoad: ({context}) => {
    handleAuthenticatedRedirect(context);
  },
});

function Home() {
  return <p>Home</p>;
}
