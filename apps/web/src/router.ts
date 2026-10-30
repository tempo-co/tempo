import {createRouter} from '@tanstack/react-router';

import {NotFound} from './components/shared/layout/not-found';
import {routeTree} from './routeTree.gen';

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  context: {
    isAuthenticated: undefined!,
    isEmailVerified: undefined!,
  },
  notFoundMode: 'root',
  defaultNotFoundComponent: NotFound,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
