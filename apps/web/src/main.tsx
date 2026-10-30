import '@fontsource-variable/inter';
import {PersistQueryClientProvider} from '@tanstack/react-query-persist-client';
import React from 'react';
import ReactDOM from 'react-dom/client';

import {SecureConnectionRequired} from '@/components/shared/layout/secure-connection-required';
import {ThemeProvider} from '@/providers/theme.provider';

import {App} from './app';
import './index.css';
import {queryClient, signOut} from './query-client';
import {router} from './router';
import {createOfflinePersistence, hasSavedAccount} from './utils/offline-storage';
import {registerOfflineShell} from './utils/register-offline-shell';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No root element found');
const root = ReactDOM.createRoot(rootElement);

// Logout is coordinated across tabs with Web Locks, which browsers expose only on HTTPS and
// localhost. Without them a signed-out session could be trusted again, so the app does not start.
if (!('locks' in navigator)) {
  root.render(
    <ThemeProvider storageKey='vite-ui-theme'>
      <SecureConnectionRequired />
    </ThemeProvider>,
  );
} else {
  const persistOptions = createOfflinePersistence(queryClient, signOut);
  registerOfflineShell();

  const appRoot = (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <App />
    </PersistQueryClientProvider>
  );
  // Each route's component is a separate chunk. Loading the first page's chunks before rendering
  // lets the page subscribe to the opening requests (useAppOpenBankRefresh) while they are in
  // flight, instead of mounting after they finish and fetching again. Without a saved account the
  // session check decides the first page, usually login, so nothing waits for a page that may not show.
  const [initialRoutes] = router.getMatchedRoutes(router.state.location.pathname);
  const preloadedRoutes = hasSavedAccount() ? initialRoutes : [];
  void Promise.all(preloadedRoutes.map(async (route) => router.loadRouteChunk(route)))
    .catch(() => {
      /* The router loads the chunk again, and reloads the page if it is gone. */
    })
    .then(() =>
      root.render(import.meta.env.DEV ? <React.StrictMode>{appRoot}</React.StrictMode> : appRoot),
    );
}
