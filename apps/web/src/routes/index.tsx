import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Index,
  beforeLoad: ({context}) => {
    if (context.isAuthenticated) {
      throw redirect({to: '/dashboard'});
    }
  },
});

function Index() {
  return <p>Welcome to Flair!</p>;
}
