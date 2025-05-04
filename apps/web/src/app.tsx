import {RouterProvider, createRouter} from '@tanstack/react-router';
import {motion} from 'framer-motion';
import React from 'react';

import {Toaster} from '@/components/ui/sonner';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {ThemeProvider} from '@/providers/theme.provider';

import Logo from './assets/logo';
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
  const {isAuthenticated, isPending, isEmailVerified} = useCurrentAccount();

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
        <motion.div
          initial={{scale: 0.9, opacity: 0}}
          animate={{scale: 1.3, opacity: 1}}
          transition={{duration: 3, ease: 'easeOut', delay: 0.5}}
        >
          <Logo className='h-16 w-16 text-primary' />
        </motion.div>
      </div>
    </ThemeProvider>
  );
}
