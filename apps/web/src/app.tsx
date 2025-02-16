import {RouterProvider, createRouter} from '@tanstack/react-router';
import {Loader} from 'lucide-react';
import React from 'react';

import {Toaster} from '@/components/ui/sonner';
import {useCurrentUser} from '@/hooks/use-current-user';
import {ThemeProvider} from '@/providers/theme.provider';

import {routeTree} from './routeTree.gen';

const router = createRouter({
  routeTree,
  context: {
    isAuthenticated: undefined!,
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const {isAuthenticated, isPending} = useCurrentUser();

  if (isPending) {
    return <LoadingScreen />;
  }

  return (
    <React.Suspense fallback={<LoadingScreen />}>
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <RouterProvider router={router} context={{isAuthenticated}} />
        <Toaster expand duration={5000} />
      </ThemeProvider>
    </React.Suspense>
  );
}

function LoadingScreen() {
  return (
    <div className='flex h-screen w-screen items-center justify-center bg-current'>
      <Loader className='h-10 w-10 animate-spin' />
    </div>
  );
}
