import {redirect} from '@tanstack/react-router';

type Context = {
  isAuthenticated: boolean;
  isEmailVerified: boolean;
};

export function handleAuthenticatedRedirect(context: Context) {
  if (!context.isAuthenticated) {
    throw redirect({to: '/login'});
  }
  if (!context.isEmailVerified) {
    throw redirect({to: '/verify-email'});
  }
}

export function handleUnauthenticatedRedirect(context: Context) {
  if (context.isAuthenticated) {
    if (context.isEmailVerified) {
      throw redirect({to: '/'});
    }
    throw redirect({to: '/verify-email'});
  }
}
