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
    isEmailVerified: undefined!,
  },
  notFoundMode: 'root',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const {isAuthenticated, isPending, isEmailVerified} = useCurrentUser();

  if (isPending) {
    return <LoadingScreen />;
  }

  return (
    <React.Suspense fallback={<LoadingScreen />}>
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <RouterProvider router={router} context={{isAuthenticated, isEmailVerified}} />
        <Toaster expand duration={5000} />
      </ThemeProvider>
    </React.Suspense>
  );
}

function LoadingScreen() {
  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <div className='flex h-screen w-screen items-center justify-center bg-background'>
        <Loader className='h-14 w-14 animate-spin' />
      </div>
    </ThemeProvider>
  );
}
