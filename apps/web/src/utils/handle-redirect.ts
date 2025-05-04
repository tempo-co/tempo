import {redirect} from '@tanstack/react-router';

type Context = {
  isAuthenticated: boolean;
  isEmailVerified: boolean;
};

export function handleAuthenticatedRedirect(context: Context) {
  if (!context.isAuthenticated) {
    throw redirect({to: '/login', search: {returnTo: getFullPath()}});
  }
  if (!context.isEmailVerified) {
    throw redirect({to: '/verify'});
  }
}

export function handleUnauthenticatedRedirect(context: Context) {
  if (context.isAuthenticated) {
    if (context.isEmailVerified) {
      throw redirect({to: '/home', search: {returnTo: getFullPath()}});
    }
    throw redirect({to: '/verify'});
  }
}

function getFullPath() {
  const currentPath = location.pathname;
  const currentSearch = location.search;
  return currentSearch ? `${currentPath}${currentSearch}` : currentPath;
}
