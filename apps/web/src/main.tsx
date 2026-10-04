import '@fontsource-variable/inter';
import {PersistQueryClientProvider} from '@tanstack/react-query-persist-client';
import React from 'react';
import ReactDOM from 'react-dom/client';

import {App} from './app';
import './index.css';
import {queryClient} from './query-client';
import {createOfflinePersistence} from './utils/offline-storage';
import {registerOfflineShell} from './utils/register-offline-shell';

const persistOptions = createOfflinePersistence(queryClient);
registerOfflineShell();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No root element found');

export const AppRoot = () => (
  <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
    <App />
  </PersistQueryClientProvider>
);

const root = ReactDOM.createRoot(rootElement);

if (import.meta.env.DEV) {
  root.render(
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>,
  );
} else {
  root.render(<AppRoot />);
}
