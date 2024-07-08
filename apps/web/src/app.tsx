import {RouterProvider, createRouter} from '@tanstack/react-router';
import {routeTree} from './routeTree.gen';
import {ThemeProvider} from './providers/theme.provider';
import {Toaster} from '@/components/ui/sonner';
import {useCurrentUser} from './hooks/use-current-user';
import {Suspense} from 'react';
import {LoaderCircle} from 'lucide-react';

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
    <Suspense
      fallback={
        <div className='flex h-screen w-screen items-center justify-center'>
          <LoaderCircle className='h-20 w-20 animate-spin' />
        </div>
      }
    >
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <RouterProvider router={router} context={{isAuthenticated}} />
        <Toaster />
      </ThemeProvider>
    </Suspense>
  );
}
