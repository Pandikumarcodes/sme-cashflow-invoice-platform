import type { QueryClient } from '@tanstack/react-query';
import { createApiClient, type RequestOptions } from '../api/client';
import { ApiError } from '../api/errors';
import {
  currentUserKey,
  loginResponseSchema,
  parseAuthResponse,
  refreshResponseSchema,
  userResponseSchema,
  type LoginInput,
  type RegisterInput,
} from './contracts';

export interface SessionState {
  status: 'checking' | 'authenticated' | 'unauthenticated';
  busy: boolean;
  error?: string;
}
export type SessionRequestOptions = RequestOptions & { replay?: 'idempotent' };

function cancelled() {
  return new DOMException('The session changed or the request was cancelled.', 'AbortError');
}
function recoveryError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) return undefined;
  return 'We could not verify your session. Please sign in again.';
}

// One controller owns the token and cookie-operation ordering for this application instance.
// User data lives only in TanStack Query; credentials are never included in snapshots/cache.
export function createSession(queryClient: QueryClient, baseUrl: string) {
  let token: string | undefined;
  let generation = 0;
  let requests = new AbortController();
  let state: SessionState = { status: 'checking', busy: false };
  const listeners = new Set<() => void>();
  const publicApi = createApiClient({ baseUrl });
  const authorizedApi = createApiClient({ baseUrl, getAccessToken: () => token });
  let refreshPromise: Promise<void> | undefined;
  let restorePromise: Promise<void> | undefined;
  let commandPromise: Promise<unknown> | undefined;
  let logoutPromise: Promise<void> | undefined;

  function publish(next: SessionState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function clear(error?: string, busy = false) {
    generation++;
    token = undefined;
    requests.abort();
    requests = new AbortController();
    void queryClient.cancelQueries();
    queryClient.clear();
    publish({ status: 'unauthenticated', busy, error });
  }
  function assertCurrent(expected: number, signal?: AbortSignal) {
    if (expected !== generation || signal?.aborted) throw cancelled();
  }
  async function verifyUser(expected: number, expectedUserId?: string) {
    const user = await queryClient.fetchQuery({
      queryKey: currentUserKey,
      retry: false,
      staleTime: 0,
      queryFn: async ({ signal }) => {
        const combined = AbortSignal.any([signal, requests.signal]);
        const response = await authorizedApi.request('/me', { signal: combined });
        assertCurrent(expected, combined);
        const result = parseAuthResponse(userResponseSchema, response.body).data;
        if (expectedUserId && result.id !== expectedUserId) throw cancelled();
        return result;
      },
    });
    assertCurrent(expected);
    return user;
  }
  function refresh() {
    if (refreshPromise) return refreshPromise;
    const expected = generation;
    const previousUserId = queryClient.getQueryData<{ id: string }>(currentUserKey)?.id;
    const operation = (async () => {
      try {
        // Never abort or retry a rotating cookie operation: its outcome could already be committed.
        const response = await publicApi.request('/auth/refresh', { method: 'POST', body: {} });
        assertCurrent(expected);
        token = parseAuthResponse(refreshResponseSchema, response.body).data.accessToken;
        await verifyUser(expected, previousUserId);
        publish({ status: 'authenticated', busy: false });
      } catch (error) {
        if (expected === generation) clear(recoveryError(error));
        throw error;
      }
    })();
    refreshPromise = operation;
    void operation
      .finally(() => {
        if (refreshPromise === operation) refreshPromise = undefined;
      })
      .catch(() => undefined);
    return operation;
  }

  async function request<T = unknown>(path: string, options: SessionRequestOptions = {}) {
    if (/^\/auth(?:\/|$)/.test(path))
      throw new Error('Authentication commands use the session methods.');
    const expected = generation;
    const signal = AbortSignal.any([requests.signal, ...(options.signal ? [options.signal] : [])]);
    assertCurrent(expected, signal);
    if (refreshPromise) {
      await waitForRefresh(refreshPromise, signal);
      assertCurrent(expected, signal);
    }
    const sentToken = token;
    try {
      const response = await authorizedApi.request<T>(path, { ...options, signal });
      assertCurrent(expected, signal);
      return response;
    } catch (error) {
      assertCurrent(expected, signal);
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (error.code !== 'UNAUTHENTICATED' || !sentToken) {
        clear();
        throw error;
      }
      const safeReplay =
        (options.method ?? 'GET') === 'GET' ||
        (options.replay === 'idempotent' &&
          /^[\x21-\x7e]{16,128}$/.test(options.idempotencyKey ?? ''));
      if (!safeReplay) {
        clear('Please sign in again before submitting another operation.');
        throw error;
      }
      // A late 401 from the old token can use an already refreshed token, in the same generation.
      if (refreshPromise || sentToken === token) {
        const pending = refresh();
        // A caller may stop waiting without cancelling the shared rotation for other callers.
        await waitForRefresh(pending, signal);
      }
      assertCurrent(expected, signal);
      try {
        const response = await authorizedApi.request<T>(path, { ...options, signal });
        assertCurrent(expected, signal);
        return response;
      } catch (replayError) {
        assertCurrent(expected, signal);
        if (replayError instanceof ApiError && replayError.status === 401) clear();
        throw replayError;
      }
    }
  }

  function restore() {
    // StrictMode and provider remounts share the same startup attempt, even after failure.
    if (!restorePromise) restorePromise = refresh().catch(() => undefined);
    return restorePromise;
  }
  function login(input: LoginInput) {
    if (state.busy || state.status === 'checking' || refreshPromise || logoutPromise)
      return Promise.reject(new Error('Please wait for the current session operation.'));
    clear(undefined, true);
    const expected = generation;
    const operation = (async () => {
      try {
        const response = await publicApi.request('/auth/login', {
          method: 'POST',
          body: { email: input.email, password: input.password },
        });
        assertCurrent(expected);
        const result = parseAuthResponse(loginResponseSchema, response.body).data;
        token = result.accessToken;
        await verifyUser(expected, result.user.id);
        publish({ status: 'authenticated', busy: false });
      } catch (error) {
        if (expected === generation) clear();
        throw error;
      }
    })();
    commandPromise = operation;
    void operation
      .finally(() => {
        if (commandPromise === operation) commandPromise = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  function register(input: RegisterInput) {
    if (state.busy || state.status === 'checking' || state.status === 'authenticated')
      return Promise.reject(new Error('Please wait for the current session operation.'));
    publish({ ...state, busy: true, error: undefined });
    const expected = generation;
    const operation = (async () => {
      try {
        const response = await publicApi.request('/auth/register', {
          method: 'POST',
          body: {
            email: input.email,
            password: input.password,
            firstName: input.firstName,
            lastName: input.lastName,
          },
        });
        assertCurrent(expected);
        return parseAuthResponse(userResponseSchema, response.body).data;
      } finally {
        if (expected === generation) publish({ status: 'unauthenticated', busy: false });
      }
    })();
    commandPromise = operation;
    void operation
      .finally(() => {
        if (commandPromise === operation) commandPromise = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  function logout() {
    if (logoutPromise) return logoutPromise;
    const pending = [refreshPromise, commandPromise];
    // Retain only the revocation request's credential while clearing the active session.
    const logoutToken = token;
    const logoutApi = createApiClient({ baseUrl, getAccessToken: () => logoutToken });
    clear(undefined, true);
    const expected = generation;
    const operation = (async () => {
      // Wait for pending Set-Cookie responses before clearing/revoking the cookie.
      await Promise.allSettled(pending.filter((value) => value !== undefined));
      try {
        await logoutApi.request('/auth/logout', { method: 'POST', body: {} });
        if (expected === generation) publish({ status: 'unauthenticated', busy: false });
      } catch {
        if (expected === generation)
          publish({
            status: 'unauthenticated',
            busy: false,
            error:
              'You are signed out here, but the service could not confirm session revocation. Try signing out again.',
          });
      }
    })();
    logoutPromise = operation;
    void operation
      .finally(() => {
        if (logoutPromise === operation) logoutPromise = undefined;
      })
      .catch(() => undefined);
    return operation;
  }
  return {
    request,
    restore,
    login,
    register,
    logout,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function waitForRefresh(pending: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(cancelled());
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      () => {
        signal.removeEventListener('abort', abort);
        resolve();
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
export type Session = ReturnType<typeof createSession>;
