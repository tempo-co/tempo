import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/home')({
  component: Home,
  beforeLoad: ({context, location}) => {
    if (!context.isAuthenticated) {
      throw redirect({to: '/login', search: {redirect: location.href}});
    }
  },
});

function Home() {
  return <p>Home</p>;
}
