import {redirect} from '@tanstack/react-router';
import {toast} from 'sonner';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const API_BASE_URL = import.meta.env.VITE_API_URL;

const shouldRedirect = (resource: string, method?: string) => {
  if (resource === '/auth/login') return false;
  if (resource === '/auth/change-email/request') return false;
  if (resource === '/users/me' && method === 'GET') return false;
  return true;
};

const request = async (resource: string, init?: RequestInit) => {
  const url = API_BASE_URL + resource;
  const headers = {...{'Content-Type': 'application/json'}, ...init?.headers};

  const response = await fetch(url, {headers, credentials: 'include', ...init}).catch(() => {
    throw toast.error('No network connection', {
      description: 'Please check your internet connection and try again.',
    });
  });

  if (!response.ok) {
    if (response.status === 401 && shouldRedirect(resource, init?.method)) {
      toast.error('Your session has expired', {
        description: 'Please log in again to continue using the app.',
      });
      throw redirect({to: '/login'});
    }
    if (response.status === 403 && resource === '/users/me') {
      toast.error('Email not verified', {
        description: 'Please verify your email to continue using the app.',
      });
      throw redirect({to: '/verify'});
    }
    if (response.status === 429) {
      throw toast.error('Rate limit exceeded', {
        description: 'Too many requests. Please try again later.',
      });
    }
    if (response.status === 500) {
      throw toast.error('Server error', {
        description: 'Your request could not be completed. Please try again.',
      });
    }

    const error = (await response.json()) as Error;
    throw new HttpError(response.status, error.message);
  }
  return response;
};

const get = (resource: string, init?: RequestInit) => {
  return request(resource, {...init, method: 'GET'});
};

const post = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'POST', body});
};

const put = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'PUT', body});
};

const patch = (resource: string, body?: BodyInit, init?: RequestInit) => {
  return request(resource, {...init, method: 'PATCH', body});
};

const _delete = (resource: string, init?: RequestInit | null) => {
  return request(resource, {...init, method: 'DELETE'});
};

export const api = {get, post, put, patch, delete: _delete};
