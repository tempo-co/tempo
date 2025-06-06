import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import {App} from './app';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('No root element found');

const queryClient = new QueryClient();

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
