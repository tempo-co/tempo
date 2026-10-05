import {RouterProvider} from '@tanstack/react-router';
import {motion} from 'framer-motion';
import React from 'react';

import {Button} from '@/components/ui/button';
import {Toaster} from '@/components/ui/sonner';
import {useConnection} from '@/hooks/use-connection';
import {useCurrentAccount} from '@/hooks/use-current-account';
import {ThemeProvider} from '@/providers/theme.provider';

import Logo from './assets/logo';
import {router} from './router';

export function App() {
  const isOnline = useConnection();
  const {
    isAuthenticated,
    isPending,
    isEmailVerified,
    isUnavailable,
    isSavedSessionUnconfirmed,
    refetch,
  } = useCurrentAccount();

  return (
    <ThemeProvider storageKey='vite-ui-theme'>
      {isUnavailable || (!isOnline && !isAuthenticated) ? (
        <div className='flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center'>
          <Logo className='h-12 w-12 text-primary' />
          <h1 className='text-xl font-semibold'>Cannot reach Tempo</h1>
          <p className='max-w-sm text-sm text-muted-foreground'>
            Your session has not been checked yet. Reconnect to continue.
          </p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : isPending || (isSavedSessionUnconfirmed && isOnline) ? (
        <LoadingScreen />
      ) : (
        <React.Suspense fallback={<LoadingScreen />}>
          {/* eslint-disable-next-line react/no-unknown-property */}
          <div vaul-drawer-wrapper=''>
            <RouterProvider router={router} context={{isAuthenticated, isEmailVerified}} />
          </div>
        </React.Suspense>
      )}
      <Toaster expand duration={5000} />
    </ThemeProvider>
  );
}

function LoadingScreen() {
  return (
    <div className='flex h-screen w-screen items-center justify-center bg-background'>
      <motion.div
        initial={{scale: 0.9, opacity: 0}}
        animate={{scale: 1.3, opacity: 1}}
        transition={{duration: 3, ease: 'easeOut', delay: 0.5}}
      >
        <Logo className='h-16 w-16 text-primary' />
      </motion.div>
    </div>
  );
}
