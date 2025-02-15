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
  const {isAuthenticated} = useCurrentUser();

  return (
    <React.Suspense
      fallback={
        <div className='flex h-screen w-screen items-center justify-center'>
          <Loader className='h-20 w-20 animate-slow-spin' />
        </div>
      }
    >
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <RouterProvider router={router} context={{isAuthenticated}} />
        <Toaster expand />
      </ThemeProvider>
    </React.Suspense>
  );
}
