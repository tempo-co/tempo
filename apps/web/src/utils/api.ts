import {toast} from 'sonner';

import {formatRetryAfter, parseRetryAfter} from './retry-after';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/** The session is gone (401); handled app-wide by sending the user to /login. */
export class SessionExpiredError extends HttpError {}

/** The API refused the request until the email is verified; handled app-wide via /verify-email. */
export class EmailNotVerifiedError extends HttpError {}

/** Message the API's auth guard sends with a 403 for accounts that have not verified their email. */
const EMAIL_NOT_VERIFIED_MESSAGE = 'Email not verified.';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const shouldRedirect = (resource: string, method?: string) => {
  if (resource === '/auth/login') return false;
  if (resource === '/auth/change-email/request') return false;
  if (resource === '/auth/change-password') return false;
  if (resource === '/auth/change-email/verify') return false;
  if (resource === '/accounts/me' && method === 'GET') return false;
  if (resource === '/accounts/me' && method === 'DELETE') return false;
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
      id: 'no-network-oconnection',
    });
  });

  if (!response.ok) {
    if (response.status === 401 && shouldRedirect(resource, init?.method)) {
      toast.error('Your session has expired', {
        description: 'Please log in again to continue using the app.',
        id: 'session-expired',
      });
      throw new SessionExpiredError(response.status, response.statusText);
    }
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(response);
      toast.error('Rate limit exceeded', {
        description: formatRetryAfter(retryAfterSeconds),
        id: 'rate-limit-exceeded',
      });
      throw new HttpError(response.status, response.statusText, retryAfterSeconds);
    }
    if (response.status === 500) {
      throw toast.error('Server error', {
        description: 'Your request could not be completed. Please try again.',
        id: 'server-error',
      });
    }

    if (init?.parseJson === false) {
      throw new HttpError(response.status, response.statusText);
    }
    const error = (await response.json()) as Error;
    if (response.status === 403 && error.message === EMAIL_NOT_VERIFIED_MESSAGE) {
      toast.error('Email not verified', {
        description: 'Please verify your email to continue using the app.',
        id: 'email-not-verified',
      });
      throw new EmailNotVerifiedError(response.status, error.message);
    }
    throw new HttpError(response.status, error.message);
  }

  if (response.status === 204) {
    return null as T;
  }

  if (init?.parseJson === false) {
    return response;
  }

  return (await response.json()) as T;
}

/** HEAD request; returns the raw Response. */
function head(resource: string, init: RequestOptions = {}): Promise<Response> {
  return request(resource, {...init, method: 'HEAD', parseJson: false});
}

function get<T = unknown>(resource: string, init?: RequestOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'GET'});
}

function post<T = unknown>(resource: string, body?: BodyInit, init?: RequestOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'POST', body});
}

function patch<T = unknown>(resource: string, body?: BodyInit, init?: RequestOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'PATCH', body});
}

function _delete<T = unknown>(resource: string, init?: RequestOptions | null): Promise<T> {
  return request<T>(resource, {...init, method: 'DELETE'});
}

export const api = {head, get, post, patch, delete: _delete};
