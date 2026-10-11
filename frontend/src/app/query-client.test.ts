import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { createApiClient } from '../api/client';
import { server } from '../test/server';
import { createQueryClient, queryKeys } from './query-client';

const baseUrl = 'http://localhost:3000/api/v1';
const api = createApiClient({ baseUrl });

it.each([500, 503, 'network'])('retries a transient %s read once', async (status) => {
  let calls = 0;
  server.use(
    http.get(`${baseUrl}/sample`, () => {
      calls++;
      return calls === 1
        ? status === 'network'
          ? HttpResponse.error()
          : new HttpResponse(null, { status: Number(status) })
        : HttpResponse.json({ data: 'recovered' });
    }),
  );
  const query = createQueryClient();
  try {
    const result = await query.fetchQuery({
      queryKey: ['sample'],
      queryFn: ({ signal }) => api.request('/sample', { signal }),
      retryDelay: 0,
    });
    expect(result.body).toEqual({ data: 'recovered' });
    expect(calls).toBe(2);
  } finally {
    query.clear();
  }
});

it.each([400, 401, 403, 404, 409, 422, 429, 500])('limits failed %s reads', async (status) => {
  let calls = 0;
  server.use(
    http.get(`${baseUrl}/sample`, () => {
      calls++;
      return new HttpResponse(null, { status });
    }),
  );
  const query = createQueryClient();
  try {
    await expect(
      query.fetchQuery({
        queryKey: ['sample'],
        queryFn: ({ signal }) => api.request('/sample', { signal }),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ status });
    expect(calls).toBe(status === 500 ? 2 : 1);
  } finally {
    query.clear();
  }
});

it('never retries failed mutations', async () => {
  let calls = 0;
  server.use(
    http.post(`${baseUrl}/command`, () => {
      calls++;
      return new HttpResponse(null, { status: 503 });
    }),
  );
  const query = createQueryClient();
  try {
    const mutation = query
      .getMutationCache()
      .build(query, { mutationFn: () => api.request('/command', { method: 'POST', body: {} }) });
    await expect(mutation.execute(undefined)).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(1);
  } finally {
    query.clear();
  }
});

it('does not retry malformed successful responses', async () => {
  let calls = 0;
  server.use(
    http.get(`${baseUrl}/sample`, () => {
      calls++;
      return new HttpResponse('invalid JSON', { headers: { 'Content-Type': 'application/json' } });
    }),
  );
  const query = createQueryClient();
  try {
    await expect(
      query.fetchQuery({
        queryKey: ['malformed'],
        queryFn: ({ signal }) => api.request('/sample', { signal }),
        retryDelay: 0,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(calls).toBe(1);
  } finally {
    query.clear();
  }
});

it('propagates query cancellation to the HTTP signal without caching a result', async () => {
  let aborted = false;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  server.use(
    http.get(`${baseUrl}/sample`, ({ request }) => {
      request.signal.addEventListener('abort', () => {
        aborted = true;
      });
      started();
      return new Promise<Response>((resolve) => {
        request.signal.addEventListener('abort', () =>
          resolve(HttpResponse.json({ data: 'late' })),
        );
      });
    }),
  );
  const query = createQueryClient();
  try {
    const pending = query.fetchQuery({
      queryKey: ['cancel'],
      queryFn: ({ signal }) => api.request('/sample', { signal }),
    });
    const rejection = expect(pending).rejects.toThrow();
    await ready;
    await query.cancelQueries({ queryKey: ['cancel'] });
    await rejection;
    expect(aborted).toBe(true);
    expect(query.getQueryData(['cancel'])).toBeUndefined();
  } finally {
    query.clear();
  }
});

it('keeps future organization cache keys distinct', () => {
  const query = createQueryClient();
  query.setQueryData(queryKeys.organization('A', 'resource'), 'A');
  expect(query.getQueryData(queryKeys.organization('B', 'resource'))).toBeUndefined();
  query.clear();
});
