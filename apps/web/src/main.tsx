import React from 'react';
import ReactDOM from 'react-dom/client';
import {RouterProvider, createRouter} from '@tanstack/react-router';
import {routeTree} from './routeTree.gen';
import './index.css';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {ThemeProvider} from './providers/theme-provider';

const queryClient = new QueryClient();
const router = createRouter({routeTree});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');

if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  );
} else {
  console.error('Failed to find the root element');
}
