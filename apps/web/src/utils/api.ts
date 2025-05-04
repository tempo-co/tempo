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
  if (resource === '/auth/change-password') return false;
  if (resource === '/accounts/me' && method === 'GET') return false;
  if (resource.startsWith('/auth/sessions') && method === 'DELETE') return false;
  return true;
};

type RequestOptions = RequestInit & {parseJson?: boolean};

/** API request with parseJson disabled; returns a Response. */
function request(resource: string, init?: RequestOptions & {parseJson: false}): Promise<Response>;
/** API request with parseJson enabled (or default); returns a parsed JSON of type T. */
function request<T = unknown>(resource: string, init?: RequestOptions): Promise<T>;
/** Implementation of API request */
async function request<T = unknown>(
  resource: string,
  init?: RequestOptions,
): Promise<T | Response> {
  const url = API_BASE_URL + resource;
  const headers = {'Content-Type': 'application/json', ...init?.headers};

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
    if (response.status === 403 && resource === '/accounts/me') {
      toast.error('Email not verified', {
        description: 'Please verify your email to continue using the app.',
      });
      throw redirect({to: '/verify-email'});
    }
    if (response.status === 429) {
      toast.error('Rate limit exceeded', {
        description: 'Too many requests. Please try again later.',
      });
      throw new HttpError(response.status, response.statusText);
    }
    if (response.status === 500) {
      throw toast.error('Server error', {
        description: 'Your request could not be completed. Please try again.',
      });
    }

    if (init?.parseJson === false) {
      throw new HttpError(response.status, response.statusText);
    }
    const error = (await response.json()) as Error;
    throw new HttpError(response.status, error.message);
  }

  if (init?.parseJson === false) {
    return response;
  }

  return (await response.json()) as T;
}

//
// HEAD overloads
//

/**
 * HEAD request with parseJson disabled; returns a Response.
 */
function head(resource: string, init?: RequestOptions & {parseJson?: false}): Promise<Response>;
/**
 * HEAD request with parseJson enabled (or default); returns parsed JSON of type T.
 */
function head<T = unknown>(resource: string, init?: RequestOptions): Promise<T>;
/**
 * Implementation of HEAD request.
 */
function head<T = unknown>(resource: string, init: RequestOptions = {}): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'HEAD', parseJson: false});
}

//
// GET overloads
//

/** GET request with parseJson disabled; returns a Response. */
function get(resource: string, init?: RequestOptions & {parseJson: false}): Promise<Response>;
/** GET request with parseJson enabled (or default); returns parsed JSON of type T. */
function get<T = unknown>(resource: string, init?: RequestOptions): Promise<T>;
/** Implementation of GET request. */
function get<T = unknown>(resource: string, init?: RequestOptions): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'GET'});
}

//
// POST overloads
//

/** POST request with parseJson disabled; returns a Response. */
function post(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions & {parseJson: false},
): Promise<Response>;
/** POST request with parseJson enabled (or default); returns parsed JSON of type T. */
function post<T = unknown>(resource: string, body?: BodyInit, init?: RequestOptions): Promise<T>;
/** Implementation of POST request. */
function post<T = unknown>(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions,
): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'POST', body});
}

//
// PUT overloads
//

/** PUT request with parseJson disabled; returns a Response. */
function put(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions & {parseJson: false},
): Promise<Response>;
/** PUT request with parseJson enabled (or default); returns parsed JSON of type T. */
function put<T = unknown>(resource: string, body?: BodyInit, init?: RequestOptions): Promise<T>;
/** Implementation of PUT request. */
function put<T = unknown>(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions,
): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'PUT', body});
}

//
// PATCH overloads
//

/** PATCH request with parseJson disabled; returns a Response. */
function patch(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions & {parseJson: false},
): Promise<Response>;
/** PATCH request with parseJson enabled (or default); returns parsed JSON of type T. */
function patch<T = unknown>(resource: string, body?: BodyInit, init?: RequestOptions): Promise<T>;
/** Implementation of PATCH request. */
function patch<T = unknown>(
  resource: string,
  body?: BodyInit,
  init?: RequestOptions,
): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'PATCH', body});
}

//
// DELETE overloads
//

/** DELETE request with parseJson disabled; returns a Response. */
function _delete(resource: string, init?: RequestOptions & {parseJson: false}): Promise<Response>;
/** DELETE request with parseJson enabled (or default); returns parsed JSON of type T. */
function _delete<T = unknown>(resource: string, init?: RequestOptions | null): Promise<T>;
/** Implementation of DELETE request. */
function _delete<T = unknown>(
  resource: string,
  init?: RequestOptions | null,
): Promise<T | Response> {
  return request<T>(resource, {...init, method: 'DELETE'});
}

export const api = {head, get, post, put, patch, delete: _delete};
