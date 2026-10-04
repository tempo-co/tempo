import {onlineManager} from '@tanstack/react-query';
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

export class NetworkError extends HttpError {
  constructor() {
    super(0, 'Cannot reach Tempo. Please try again when the connection returns.');
  }
}

/** The session is gone (401); handled app-wide by sending the user to /login. */
export class SessionExpiredError extends HttpError {}

/** The API refused the request until the email is verified; handled app-wide via /verify-email. */
export class EmailNotVerifiedError extends HttpError {}

/** Message the API's auth guard sends with a 403 for accounts that have not verified their email. */
const EMAIL_NOT_VERIFIED_MESSAGE = 'Email not verified.';

const API_BASE_URL = import.meta.env.VITE_API_URL;

let sessionEpoch = 0;
const PENDING_LOGOUT_KEY = 'tempo-pending-logout';
let logoutRequest: Promise<void> | undefined;
let unpersistedLogout = false;

/** Only logout is completed after reconnection. User changes are never queued or replayed. */
export async function completePendingLogout() {
  if (!unpersistedLogout && localStorage.getItem(PENDING_LOGOUT_KEY) !== 'true') return;
  if (logoutRequest) return logoutRequest;
  logoutRequest = (async () => {
    await navigator.locks.request('tempo-logout', async () => {
      // Another tab may have completed the logout while this tab waited for the lock.
      if (!unpersistedLogout && localStorage.getItem(PENDING_LOGOUT_KEY) !== 'true') return;
      if (!onlineManager.isOnline()) throw new NetworkError();
      const response = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        signal: AbortSignal.timeout(15000),
      }).catch(() => {
        onlineManager.setOnline(false);
        throw new NetworkError();
      });
      if (!response.ok && response.status !== 401) {
        throw new HttpError(response.status, 'Tempo could not confirm the logout.');
      }
      localStorage.removeItem(PENDING_LOGOUT_KEY);
      unpersistedLogout = false;
    });
  })();
  try {
    await logoutRequest;
  } finally {
    logoutRequest = undefined;
  }
}

export function beginLogout() {
  try {
    localStorage.setItem(PENDING_LOGOUT_KEY, 'true');
  } catch {
    unpersistedLogout = true;
    toast.warning('Keep Tempo open until logout is confirmed', {
      description: 'This browser could not remember the unfinished logout.',
    });
  }
}

/**
 * Ends the signed-in session in this tab. Responses to requests started before this call are
 * discarded, so a late reply cannot restore an account or its data after logout.
 */
export function endSession() {
  sessionEpoch++;
}

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
  await completePendingLogout();
  const url = API_BASE_URL + resource;
  const headers = {'Content-Type': 'application/json', ...init?.headers};

  const epoch = sessionEpoch;
  const isWrite = !['GET', 'HEAD'].includes(init?.method ?? 'GET');
  if (isWrite && !onlineManager.isOnline()) {
    toast.error('Changes cannot be saved while Tempo is unreachable.');
    throw new NetworkError();
  }
  const response = await fetch(url, {
    headers,
    credentials: 'include',
    ...init,
    signal: init?.signal ?? (!isWrite ? AbortSignal.timeout(15000) : undefined),
  }).catch(() => {
    onlineManager.setOnline(false);
    if (isWrite)
      toast.error(
        'Cannot reach Tempo. Your change was not confirmed. Please check before trying again.',
      );
    throw new NetworkError();
  });
  // Any reply, including an error status, proves Tempo is reachable. The API itself answers 502/503
  // when the bank provider fails, so only a failed request means the connection is down.
  onlineManager.setOnline(true);
  if (epoch !== sessionEpoch) throw new SessionExpiredError(401, 'Signed out');

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
    if (response.status >= 500) {
      throw new HttpError(response.status, 'Tempo is temporarily unavailable. Please try again.');
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

  const body = (await response.json()) as T;
  if (epoch !== sessionEpoch) throw new SessionExpiredError(401, 'Signed out');
  return body;
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
