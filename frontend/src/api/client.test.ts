import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { createApiClient, type HttpMethod } from './client';

const baseUrl = 'http://localhost:3000/api/v1';
const client = createApiClient({ baseUrl });

describe('API transport', () => {
  it.each<HttpMethod>(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])(
    'sends %s under the API root with cookies',
    async (method) => {
      server.use(
        http.all(`${baseUrl}/sample`, ({ request }) => {
          expect(request.method).toBe(method);
          expect(request.credentials).toBe('include');
          expect(new URL(request.url).searchParams.get('limit')).toBe('10');
          expect(request.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
          return HttpResponse.json({ data: { ok: true } });
        }),
      );
      expect((await client.request('/sample', { method, query: { limit: 10 } })).body).toEqual({
        data: { ok: true },
      });
    },
  );

  it('reads the current memory token on each request and omits it when absent', async () => {
    let token: string | undefined = 'first';
    const authorized = createApiClient({ baseUrl, getAccessToken: () => token });
    const seen: (string | null)[] = [];
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    server.use(
      http.get(`${baseUrl}/sample`, ({ request }) => {
        seen.push(request.headers.get('Authorization'));
        return HttpResponse.json({ data: {} });
      }),
    );
    await authorized.request('/sample');
    token = 'second';
    await authorized.request('/sample');
    token = undefined;
    await authorized.request('/sample');
    expect(seen).toEqual(['Bearer first', 'Bearer second', null]);
    expect(storage).not.toHaveBeenCalled();
  });

  it('distinguishes no body from an empty JSON command and forwards concurrency headers', async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${baseUrl}/command`, async ({ request }) => {
        seen.push({
          body: await request.text(),
          type: request.headers.get('Content-Type'),
          match: request.headers.get('If-Match'),
          key: request.headers.get('Idempotency-Key'),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await client.request('/command', { method: 'POST' });
    await client.request('/command', {
      method: 'POST',
      body: {},
      ifMatch: '"3"',
      idempotencyKey: 'command-key',
    });
    expect(seen).toEqual([
      { body: '', type: null, match: null, key: null },
      { body: '{}', type: 'application/json', match: '"3"', key: 'command-key' },
    ]);
  });

  it('preserves Decimal strings, business dates and server pagination envelopes', async () => {
    const payload = {
      data: [{ total: '9007199254740993.10', quantity: '0.125', date: '2026-10-11' }],
      meta: { limit: 1, nextCursor: 'opaque-cursor', hasMore: true },
    };
    server.use(
      http.get(`${baseUrl}/sample`, () =>
        HttpResponse.json(payload, { headers: { ETag: '"7"', 'X-Request-Id': 'response-id' } }),
      ),
    );
    const result = await client.request<typeof payload>('/sample');
    expect(result.body).toEqual(payload);
    expect(typeof result.body?.data[0]?.total).toBe('string');
    expect(result.headers.get('ETag')).toBe('"7"');
    expect(result.requestId).toBe('response-id');
  });

  it('parses canonical validation errors without displaying raw server text', async () => {
    server.use(
      http.get(`${baseUrl}/sample`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'SQL private internals',
              requestId: 'canonical-id',
              fields: [
                { field: 'items.0.quantity', code: 'INVALID_FIELD', message: 'private input' },
              ],
              details: { version: 2 },
            },
          },
          { status: 422 },
        ),
      ),
    );
    await expect(client.request('/sample')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 422,
      requestId: 'canonical-id',
      message: 'Please check the highlighted fields.',
      fields: [{ field: 'items.0.quantity', code: 'INVALID_FIELD', message: 'Check this field.' }],
      details: { version: 2 },
    });
  });

  it('does not replay a 401 and safely handles noncanonical error responses', async () => {
    let count = 0;
    server.use(
      http.get(`${baseUrl}/sample`, () => {
        count++;
        return new HttpResponse('<h1>private exception</h1>', {
          status: 401,
          headers: { 'X-Request-Id': 'header-id' },
        });
      }),
    );
    await expect(client.request('/sample')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 401,
      requestId: 'header-id',
      message: 'Please sign in to continue.',
    });
    expect(count).toBe(1);
  });

  it('returns a safe network error', async () => {
    server.use(http.get(`${baseUrl}/sample`, () => HttpResponse.error()));
    await expect(client.request('/sample')).rejects.toMatchObject({
      kind: 'network',
      code: 'NETWORK_ERROR',
      status: undefined,
    });
  });

  it.each([204, 205, 200])('accepts empty status %s responses', async (status) => {
    server.use(http.get(`${baseUrl}/sample`, () => new HttpResponse(null, { status })));
    expect((await client.request('/sample')).body).toBeUndefined();
  });

  it('supports explicit text and blob responses', async () => {
    server.use(
      http.get(
        `${baseUrl}/sample`,
        () => new HttpResponse('a,b\n1,2', { headers: { 'Content-Type': 'text/csv' } }),
      ),
    );
    expect((await client.request<string>('/sample', { responseType: 'text' })).body).toBe(
      'a,b\n1,2',
    );
    const result = await client.request<Blob>('/sample', { responseType: 'blob' });
    expect(result.body?.size).toBe(7);
  });

  it.each(['text/html', 'application/json'])(
    'rejects invalid successful %s responses safely',
    async (type) => {
      server.use(
        http.get(
          `${baseUrl}/sample`,
          () =>
            new HttpResponse('private malformed payload', { headers: { 'Content-Type': type } }),
        ),
      );
      await expect(client.request('/sample')).rejects.toMatchObject({
        kind: 'invalid-response',
        code: 'INVALID_RESPONSE',
        status: 200,
      });
    },
  );

  it('preserves AbortSignal cancellation', async () => {
    server.use(
      http.get(`${baseUrl}/sample`, async () => {
        await delay(100);
        return HttpResponse.json({ data: {} });
      }),
    );
    const controller = new AbortController();
    const pending = client.request('/sample', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it.each([
    'https://external.test',
    '//external.test',
    '/../auth',
    '/%2e%2e/auth',
    '/sample?secret=yes',
  ])('rejects unsafe path %s before sending credentials', async (path) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(client.request(path)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects GET bodies', async () => {
    await expect(client.request('/sample', { body: {} })).rejects.toThrow(
      'GET requests cannot contain a body',
    );
  });
});
