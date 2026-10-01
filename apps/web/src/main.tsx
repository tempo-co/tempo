import '@fontsource-variable/inter';
import {QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import {App} from './app';
import './index.css';
import {queryClient} from './query-client';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No root element found');

export const AppRoot = () => (
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
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
