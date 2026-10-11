import { ApiError, isAbortError, parseApiError } from './errors';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface RequestOptions {
  method?: HttpMethod;
  body?: JsonValue;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  ifMatch?: string;
  idempotencyKey?: string;
  responseType?: 'json' | 'text' | 'blob';
}
export interface ApiResponse<T> {
  body: T | undefined;
  status: number;
  headers: Headers;
  requestId: string | undefined;
}

export function createApiClient({
  baseUrl,
  getAccessToken = () => undefined,
}: {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
}) {
  const base = new URL(baseUrl.replace(/\/$/, '') + '/');
  return {
    async request<T = unknown>(
      path: string,
      options: RequestOptions = {},
    ): Promise<ApiResponse<T>> {
      // Only paths relative to the configured API root are accepted. Prevent
      // accidental token disclosure through external URLs or traversal.
      if (
        !path.startsWith('/') ||
        path.startsWith('//') ||
        /[\\?#]/.test(path) ||
        path.split('/').some((segment) => ['.', '..'].includes(decodeURIComponent(segment)))
      )
        throw new Error('API paths must be relative resource paths without query or traversal.');
      const url = new URL(path.slice(1), base);
      if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
        throw new Error('Invalid API path.');
      const method = options.method ?? 'GET';
      if (method === 'GET' && options.body !== undefined)
        throw new Error('GET requests cannot contain a body.');
      Object.entries(options.query ?? {}).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.set(key, String(value));
      });
      const headers = new Headers({
        Accept: options.responseType === 'blob' ? 'text/csv' : 'application/json',
        'X-Request-Id': crypto.randomUUID(),
      });
      const token = getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (options.body !== undefined) headers.set('Content-Type', 'application/json');
      if (options.ifMatch !== undefined) headers.set('If-Match', options.ifMatch);
      if (options.idempotencyKey !== undefined)
        headers.set('Idempotency-Key', options.idempotencyKey);
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          credentials: 'include',
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: options.signal,
          redirect: 'error',
        });
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) throw error;
        throw new ApiError(
          'Unable to reach the service. Check your connection and try again.',
          'NETWORK_ERROR',
          undefined,
          'network',
        );
      }
      const requestId = response.headers.get('X-Request-Id') ?? undefined;
      try {
        if (!response.ok) {
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (error) {
            if (isAbortError(error)) throw error;
          }
          throw parseApiError(payload, response.status, requestId);
        }
        let body: unknown;
        if (response.status === 204 || response.status === 205) body = undefined;
        else if (options.responseType === 'blob') body = await response.blob();
        else {
          const text = await response.text();
          if (!text.trim()) body = undefined;
          else if (options.responseType === 'text') body = text;
          else if (
            /\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('Content-Type') ?? '')
          )
            body = JSON.parse(text) as unknown;
          else throw new Error('Unexpected response type');
        }
        return {
          body: body as T | undefined,
          status: response.status,
          headers: response.headers,
          requestId,
        };
      } catch (error) {
        if (error instanceof ApiError || isAbortError(error) || options.signal?.aborted)
          throw error;
        throw new ApiError(
          'The service returned an unexpected response. Please try again.',
          'INVALID_RESPONSE',
          response.status,
          'invalid-response',
          requestId,
        );
      }
    },
  };
}
