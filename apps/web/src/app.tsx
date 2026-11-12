import {RouterProvider} from '@tanstack/react-router';
import {motion} from 'framer-motion';
import {CloudOff, RotateCw, WifiOff} from 'lucide-react';
import React, {useEffect} from 'react';

import {StateMessage} from '@/components/shared/state-message';
import {Button} from '@/components/ui/button';
import {Toaster} from '@/components/ui/sonner';
import {useAppOpenBankRefresh} from '@/features/banking/api/use-app-open-bank-refresh';
import {useConnection} from '@/hooks/use-connection';
import {
  markSavedSessionShown,
  useCurrentAccount,
  wasSavedSessionShown,
} from '@/hooks/use-current-account';
import {useIsMobile} from '@/hooks/use-is-mobile';
import {ThemeProvider} from '@/providers/theme.provider';

import Logo from './assets/logo';
import {router} from './router';

const TAB_BAR_TOAST_OFFSET = 'calc(4.5rem + env(safe-area-inset-bottom))';

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
  useAppOpenBankRefresh();
  const isShowingSavedSession = isSavedSessionUnconfirmed && !isOnline;
  useEffect(() => {
    if (isShowingSavedSession) markSavedSessionShown();
  }, [isShowingSavedSession]);
  // Below md, signed-in pages keep the tab bar at the bottom; toasts stay above it.
  const hasTabBar = useIsMobile() && isAuthenticated && !!isEmailVerified;

  return (
    <ThemeProvider storageKey='vite-ui-theme'>
      {isUnavailable || (!isOnline && !isAuthenticated) ? (
        <div className='flex min-h-screen flex-col items-center justify-center gap-6 p-4 sm:p-6'>
          <Logo className='h-12 w-12 text-primary' />
          <StateMessage
            className='w-full max-w-md'
            tone='error'
            titleAs='h1'
            icon={navigator.onLine ? CloudOff : WifiOff}
            title="Can't reach Tempo"
            description={
              navigator.onLine
                ? "Tempo isn't answering right now. Try again in a moment."
                : "You're offline. Connect to the internet, then try again."
            }
          >
            <Button variant='outline' onClick={() => void refetch()}>
              <RotateCw aria-hidden='true' />
              Try again
            </Button>
          </StateMessage>
        </div>
      ) : isPending || (isSavedSessionUnconfirmed && isOnline && !wasSavedSessionShown()) ? (
        <LoadingScreen />
      ) : (
        <React.Suspense fallback={<LoadingScreen />}>
          <RouterProvider router={router} context={{isAuthenticated, isEmailVerified}} />
        </React.Suspense>
      )}
      <Toaster
        offset={hasTabBar ? {bottom: TAB_BAR_TOAST_OFFSET} : undefined}
        mobileOffset={hasTabBar ? {bottom: TAB_BAR_TOAST_OFFSET} : undefined}
      />
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
        <Logo className='h-20 w-20 text-primary' />
      </motion.div>
    </div>
  );
}
