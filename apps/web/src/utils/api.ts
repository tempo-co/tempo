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

  /** The api wrapper already showed a toast for this failure. */
  toasted = false;
}

export class NetworkError extends HttpError {
  constructor() {
    super(0, 'Cannot reach Tempo. Please try again when the connection returns.');
  }
}

/** The session is gone (401); handled app-wide by sending the user to /login. */
export class SessionExpiredError extends HttpError {}

/** The tab signed out or in while the request was open; its reply belongs to another session. */
export class SessionChangedError extends Error {}

/** The API refused the request until the email is verified; handled app-wide via /verify-email. */
export class EmailNotVerifiedError extends HttpError {}

/** Errors the query client handles app-wide with its own toast and redirect. */
export const isAuthError = (error: unknown) =>
  error instanceof SessionExpiredError || error instanceof EmailNotVerifiedError;

/** Whether the api wrapper already toasted this failure, so the call site must not add its own. */
export const wasToasted = (error: unknown) => error instanceof HttpError && error.toasted;

/** Marks an error the wrapper has just toasted. */
function toasted<E extends HttpError>(error: E): E {
  error.toasted = true;
  return error;
}

/** Message the API's auth guard sends with a 403 for accounts that have not verified their email. */
const EMAIL_NOT_VERIFIED_MESSAGE = 'Email not verified.';

/** Message the API sends with a 401 when a signed-in account's password confirmation is wrong. */
export const INVALID_PASSWORD_MESSAGE = 'Invalid password.';

const API_BASE_URL = import.meta.env.VITE_API_URL;

let sessionEpoch = 0;
let sessionController = new AbortController();

/** Cancels foreground work at logout intent and whenever this tab changes sessions. */
export const getSessionSignal = () => sessionController.signal;
const PENDING_LOGOUT_KEY = 'tempo-pending-logout';
let logoutRequest: Promise<void> | undefined;
let unpersistedLogout = false;

function hasPendingLogout() {
  try {
    return unpersistedLogout || localStorage.getItem(PENDING_LOGOUT_KEY) === 'true';
  } catch {
    return unpersistedLogout;
  }
}

/** Only logout is completed after reconnection. User changes are never queued or replayed. */
export async function completePendingLogout() {
  if (!hasPendingLogout()) return;
  if (logoutRequest) return logoutRequest;
  logoutRequest = (async () => {
    await navigator.locks.request('tempo-logout', async () => {
      // Another tab may have completed the logout while this tab waited for the lock.
      if (!hasPendingLogout()) return;
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
      try {
        localStorage.removeItem(PENDING_LOGOUT_KEY);
      } catch {
        /* Storage may be disabled; the marker was then never stored. */
      }
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
  changeSession();
  // Keep this signal cancelled until signOut/signIn establishes the next session.
  sessionController.abort();
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
 * Starts a new session in this tab. Responses to requests started before this call are discarded,
 * so a late reply can neither restore a signed-out account nor sign out the next one.
 */
export function changeSession() {
  sessionEpoch++;
  sessionController.abort();
  sessionController = new AbortController();
}

function assertSameSession(epoch: number) {
  if (epoch !== sessionEpoch) throw new SessionChangedError('Session changed');
}

type RequestOptions = RequestInit & {
  parseJson?: boolean;
  /**
   * A 401 is an answer the caller handles, such as a wrong password, rather than an ended session.
   * It is then thrown as a plain HttpError, without the session-expired toast and sign-out.
   * A message limits this to a 401 with that message; any other 401 is an ended session.
   */
  expectUnauthorized?: boolean | string;
};
/** Options for post/patch/delete, which take the JSON body as a value and serialize it. */
type WriteOptions = Omit<RequestOptions, 'body'>;

/** API request with parseJson disabled; returns a Response. */
function request(resource: string, init?: RequestOptions & {parseJson: false}): Promise<Response>;
/** API request with parseJson enabled (or default); returns a parsed JSON of type T. */
function request<T = unknown>(resource: string, init?: RequestOptions): Promise<T>;
/** Implementation of API request */
async function request<T = unknown>(
  resource: string,
  init?: RequestOptions,
): Promise<T | Response> {
  init?.signal?.throwIfAborted();
  await completePendingLogout();
  init?.signal?.throwIfAborted();
  const url = API_BASE_URL + resource;
  const headers = {'Content-Type': 'application/json', ...init?.headers};

  const epoch = sessionEpoch;
  const isWrite = !['GET', 'HEAD'].includes(init?.method ?? 'GET');
  if (isWrite && !onlineManager.isOnline()) {
    toast.error('Changes cannot be saved while Tempo is unreachable.');
    throw toasted(new NetworkError());
  }
  const response = await fetch(url, {
    headers,
    credentials: 'include',
    ...init,
    signal: init?.signal ?? (!isWrite ? AbortSignal.timeout(15000) : undefined),
  }).catch((error: unknown) => {
    // A foreground lifecycle cancellation is not a lost connection or an unconfirmed write.
    if (init?.signal?.aborted && error instanceof DOMException && error.name === 'AbortError')
      throw error;
    onlineManager.setOnline(false);
    if (!isWrite) throw new NetworkError();
    toast.error(
      'Cannot reach Tempo. Your change was not confirmed. Please check before trying again.',
    );
    throw toasted(new NetworkError());
  });
  // Any reply, including an error status, proves Tempo is reachable. The API itself answers 502/503
  // when the bank provider fails, so only a failed request means the connection is down.
  init?.signal?.throwIfAborted();
  onlineManager.setOnline(true);
  assertSameSession(epoch);

  if (!response.ok) {
    if (response.status === 401 && init?.expectUnauthorized !== true) {
      const expectedMessage = init?.expectUnauthorized;
      if (expectedMessage) {
        const body: unknown = await response.json().catch(() => null);
        assertSameSession(epoch);
        init?.signal?.throwIfAborted();
        if (
          body !== null &&
          typeof body === 'object' &&
          'message' in body &&
          body.message === expectedMessage
        )
          throw new HttpError(response.status, expectedMessage);
      }
      toast.error('Your session has expired', {
        description: 'Please log in again to continue using the app.',
        id: 'session-expired',
      });
      throw toasted(new SessionExpiredError(response.status, response.statusText));
    }
    if (response.status === 429) {
      let retryAfterSeconds = parseRetryAfter(response);
      if (retryAfterSeconds === undefined) {
        const body: unknown = await response.json().catch(() => null);
        assertSameSession(epoch);
        init?.signal?.throwIfAborted();
        if (body !== null && typeof body === 'object' && 'retryAfterSeconds' in body) {
          const seconds = body.retryAfterSeconds;
          if (
            typeof seconds === 'number' &&
            Number.isFinite(seconds) &&
            seconds >= 0 &&
            seconds <= Number.MAX_SAFE_INTEGER
          ) {
            retryAfterSeconds = seconds;
          }
        }
      }
      toast.error('Rate limit exceeded', {
        description: formatRetryAfter(retryAfterSeconds),
        id: 'rate-limit-exceeded',
      });
      throw toasted(new HttpError(response.status, response.statusText, retryAfterSeconds));
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
      throw toasted(new EmailNotVerifiedError(response.status, error.message));
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
  assertSameSession(epoch);
  init?.signal?.throwIfAborted();
  return body;
}

/** HEAD request; returns the raw Response. */
function head(resource: string, init: RequestOptions = {}): Promise<Response> {
  return request(resource, {...init, method: 'HEAD', parseJson: false});
}

function get<T = unknown>(resource: string, init?: RequestOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'GET'});
}

const json = (body: unknown) => (body === undefined ? undefined : JSON.stringify(body));

function post<T = unknown>(resource: string, body?: unknown, init?: WriteOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'POST', body: json(body)});
}

function patch<T = unknown>(resource: string, body?: unknown, init?: WriteOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'PATCH', body: json(body)});
}

function _delete<T = unknown>(resource: string, body?: unknown, init?: WriteOptions): Promise<T> {
  return request<T>(resource, {...init, method: 'DELETE', body: json(body)});
}

export const api = {head, get, post, patch, delete: _delete};
