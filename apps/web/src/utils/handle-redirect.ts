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
    throw redirect({to: '/verify', search: {returnTo: getFullPath()}});
  }
}

export function handleUnauthenticatedRedirect(context: Context) {
  if (context.isAuthenticated) {
    if (context.isEmailVerified) {
      throw redirect({to: '/home', search: {returnTo: getFullPath()}});
    }
    throw redirect({to: '/verify', search: {returnTo: getFullPath()}});
  }
}

function getFullPath(): string {
  const currentPath = location.pathname;
  const currentSearch = location.search;
  return currentSearch ? `${currentPath}${currentSearch}` : currentPath;
}
