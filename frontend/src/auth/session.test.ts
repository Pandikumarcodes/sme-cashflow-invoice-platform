import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../app/query-client';
import { server } from '../test/server';
import {
  apiRoot,
  authFailure,
  authHandlers,
  deferred,
  loginInput,
  testUser,
  tokenResponse,
} from '../test/auth-fixtures';
import { currentUserKey } from './contracts';
import { createSession } from './session';

const clients: ReturnType<typeof createQueryClient>[] = [];
function setup() {
  const query = createQueryClient();
  clients.push(query);
  return { query, session: createSession(query, apiRoot) };
}
async function signedIn() {
  const fixture = setup();
  await fixture.session.restore();
  await fixture.session.login(loginInput);
  return fixture;
}
beforeEach(() => server.use(...authHandlers()));
afterEach(() => {
  clients.splice(0).forEach((query) => query.clear());
});

describe('session lifecycle', () => {
  it('signs in only after a current-user check, using JSON and credentialed requests', async () => {
    const { session, query } = setup();
    await session.restore();
    let verified = false;
    server.use(
      http.post(`${apiRoot}/auth/login`, async ({ request }) => {
        expect(request.credentials).toBe('include');
        expect(request.headers.get('Content-Type')).toBe('application/json');
        expect(request.headers.get('Authorization')).toBeNull();
        expect(await request.json()).toEqual(loginInput);
        return HttpResponse.json({ data: { ...tokenResponse().data, user: testUser } });
      }),
      http.get(`${apiRoot}/me`, ({ request }) => {
        verified = true;
        expect(request.headers.get('Authorization')).toBe('Bearer memory-access-token');
        return HttpResponse.json({ data: testUser });
      }),
    );
    await session.login(loginInput);
    expect(verified).toBe(true);
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(query.getQueryData(currentUserKey)).toEqual(testUser);
  });
  it('keeps failed login unauthenticated', async () => {
    const { session, query } = setup();
    await session.restore();
    server.use(http.post(`${apiRoot}/auth/login`, () => authFailure('INVALID_CREDENTIALS')));
    await expect(session.login(loginInput)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(session.getSnapshot().status).toBe('unauthenticated');
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
  });
  it('registers a global user without creating a session', async () => {
    const { session, query } = setup();
    await session.restore();
    expect(
      await session.register({ ...loginInput, firstName: 'Alex', lastName: 'Morgan' }),
    ).toEqual(testUser);
    expect(session.getSnapshot().status).toBe('unauthenticated');
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
  });
  it('restores a reload through one rotated cookie then /me, deduplicating startup', async () => {
    let calls = 0;
    server.use(
      http.post(`${apiRoot}/auth/refresh`, async ({ request }) => {
        calls++;
        expect(await request.json()).toEqual({});
        expect(request.headers.get('Authorization')).toBeNull();
        return HttpResponse.json(tokenResponse());
      }),
    );
    const { session, query } = setup();
    await Promise.all([session.restore(), session.restore(), session.restore()]);
    expect(calls).toBe(1);
    expect(session.getSnapshot().status).toBe('authenticated');
    expect(query.getQueryData(currentUserKey)).toEqual(testUser);
  });
  it.each(['INVALID_SESSION', 'SESSION_COMPROMISED'])(
    'handles %s without repeating startup refresh',
    async (code) => {
      let calls = 0;
      server.use(
        http.post(`${apiRoot}/auth/refresh`, () => {
          calls++;
          return authFailure(code);
        }),
      );
      const { session } = setup();
      await session.restore();
      await session.restore();
      expect(session.getSnapshot()).toMatchObject({ status: 'unauthenticated', busy: false });
      expect(calls).toBe(1);
    },
  );
  it('handles an uncertain refresh network failure without retrying rotation', async () => {
    let calls = 0;
    server.use(
      http.post(`${apiRoot}/auth/refresh`, () => {
        calls++;
        return HttpResponse.error();
      }),
    );
    const { session } = setup();
    await session.restore();
    await session.restore();
    expect(session.getSnapshot().error).toMatch(/could not verify/);
    expect(calls).toBe(1);
  });
  it('rejects malformed authentication responses and failed /me verification', async () => {
    const { session, query } = setup();
    await session.restore();
    server.use(http.get(`${apiRoot}/me`, () => authFailure()));
    await expect(session.login(loginInput)).rejects.toMatchObject({ status: 401 });
    expect(session.getSnapshot().status).toBe('unauthenticated');
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
    server.use(
      http.post(`${apiRoot}/auth/login`, () =>
        HttpResponse.json({ data: { accessToken: 'private-token' } }),
      ),
    );
    await expect(session.login(loginInput)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not persist credentials, cache tokens, or log sensitive input', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
    ];
    const { session, query } = await signedIn();
    expect(storage).not.toHaveBeenCalled();
    expect(
      JSON.stringify(
        query
          .getQueryCache()
          .getAll()
          .map((entry) => entry.state.data),
      ),
    ).not.toContain('memory-access-token');
    await session.logout();
    logs.forEach((log) => expect(log).not.toHaveBeenCalled());
  });
  it('clears credentials and every account cache immediately on logout', async () => {
    const { session, query } = await signedIn();
    server.use(
      http.post(`${apiRoot}/auth/logout`, async ({ request }) => {
        expect(request.headers.get('Authorization')).toBe('Bearer memory-access-token');
        expect(await request.json()).toEqual({});
        return new HttpResponse(null, { status: 204 });
      }),
    );
    query.setQueryData(['organization', 'A', 'private'], { secret: 'account-data' });
    const pending = session.logout();
    expect(session.getSnapshot().status).toBe('unauthenticated');
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
    expect(query.getQueryData(['organization', 'A', 'private'])).toBeUndefined();
    await pending;
    let header: string | null = 'not-called';
    server.use(
      http.get(`${apiRoot}/sample`, ({ request }) => {
        header = request.headers.get('Authorization');
        return HttpResponse.json({ data: {} });
      }),
    );
    await session.request('/sample');
    expect(header).toBeNull();
  });
  it('removes old-account cache before logging into a different account', async () => {
    const { session, query } = await signedIn();
    query.setQueryData(['private'], 'old data');
    await session.logout();
    const userB = {
      ...testUser,
      id: 'e7538476-c904-4cca-8ea7-258c6943b397',
      email: 'b@example.test',
    };
    server.use(
      http.post(`${apiRoot}/auth/login`, () =>
        HttpResponse.json({ data: { ...tokenResponse('account-B').data, user: userB } }),
      ),
      http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: userB })),
    );
    await session.login({ ...loginInput, email: userB.email });
    expect(query.getQueryData(['private'])).toBeUndefined();
    expect(query.getQueryData(currentUserKey)).toEqual(userB);
  });
  it('reports failed server logout without restoring local credentials', async () => {
    const { session } = await signedIn();
    server.use(http.post(`${apiRoot}/auth/logout`, () => HttpResponse.error()));
    await session.logout();
    expect(session.getSnapshot()).toMatchObject({ status: 'unauthenticated', busy: false });
    expect(session.getSnapshot().error).toMatch(/could not confirm session revocation/);
  });
});

describe('bounded refresh recovery', () => {
  it('recovers an expired read once and deduplicates concurrent requests', async () => {
    const { session } = await signedIn();
    let refreshes = 0;
    let reads = 0;
    const gate = deferred();
    const started = deferred();
    server.use(
      http.post(`${apiRoot}/auth/refresh`, async () => {
        refreshes++;
        started.resolve();
        await gate.promise;
        return HttpResponse.json(tokenResponse('rotated'));
      }),
      http.get(`${apiRoot}/sample`, ({ request }) => {
        reads++;
        return request.headers.get('Authorization') === 'Bearer rotated'
          ? HttpResponse.json({ data: 'ok' })
          : authFailure();
      }),
    );
    const results = [
      session.request('/sample'),
      session.request('/sample'),
      session.request('/sample'),
    ];
    await started.promise;
    gate.resolve();
    expect((await Promise.all(results)).every((result) => result.body !== undefined)).toBe(true);
    expect(refreshes).toBe(1);
    expect(reads).toBe(6);
  });
  it('uses the rotated token for a late old-token 401 without another refresh', async () => {
    const { session } = await signedIn();
    let refreshes = 0;
    const late = deferred();
    const started = deferred();
    server.use(
      http.post(`${apiRoot}/auth/refresh`, () => {
        refreshes++;
        return HttpResponse.json(tokenResponse('rotated'));
      }),
      http.get(`${apiRoot}/slow`, async ({ request }) => {
        if (request.headers.get('Authorization') !== 'Bearer rotated') {
          started.resolve();
          await late.promise;
          return authFailure();
        }
        return HttpResponse.json({ data: true });
      }),
      http.get(`${apiRoot}/fast`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer rotated'
          ? HttpResponse.json({ data: true })
          : authFailure(),
      ),
    );
    const delayed = session.request('/slow');
    await started.promise;
    await session.request('/fast');
    late.resolve();
    await delayed;
    expect(refreshes).toBe(1);
  });
  it('clears a failed refresh without recursion or replay', async () => {
    const { session, query } = await signedIn();
    let calls = 0;
    server.use(
      http.get(`${apiRoot}/sample`, () => authFailure()),
      http.post(`${apiRoot}/auth/refresh`, () => {
        calls++;
        return authFailure('SESSION_COMPROMISED');
      }),
    );
    await expect(session.request('/sample')).rejects.toThrow();
    expect(calls).toBe(1);
    expect(session.getSnapshot().status).toBe('unauthenticated');
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
  });
  it('stops after one replay also returns 401', async () => {
    const { session } = await signedIn();
    let refreshes = 0;
    let reads = 0;
    server.use(
      http.post(`${apiRoot}/auth/refresh`, () => {
        refreshes++;
        return HttpResponse.json(tokenResponse('rotated'));
      }),
      http.get(`${apiRoot}/sample`, () => {
        reads++;
        return authFailure();
      }),
    );
    await expect(session.request('/sample')).rejects.toThrow();
    expect(refreshes).toBe(1);
    expect(reads).toBe(2);
    expect(session.getSnapshot().status).toBe('unauthenticated');
  });
  it('does not refresh on permission denial, network failure or unknown 401 codes', async () => {
    const { session } = await signedIn();
    const refresh = vi.fn(() => HttpResponse.json(tokenResponse()));
    server.use(
      http.post(`${apiRoot}/auth/refresh`, refresh),
      http.get(`${apiRoot}/forbidden`, () => authFailure('FORBIDDEN', 403)),
      http.get(`${apiRoot}/network`, () => HttpResponse.error()),
      http.get(`${apiRoot}/unknown`, () => authFailure('INVALID_SESSION')),
    );
    await expect(session.request('/forbidden')).rejects.toMatchObject({ status: 403 });
    expect(session.getSnapshot().status).toBe('authenticated');
    await expect(session.request('/network')).rejects.toMatchObject({ kind: 'network' });
    await expect(session.request('/unknown')).rejects.toMatchObject({ status: 401 });
    expect(refresh).not.toHaveBeenCalled();
  });
  it('never replays mutations without explicit approval and a valid original key', async () => {
    const { session } = await signedIn();
    let commands = 0;
    let refreshes = 0;
    server.use(
      http.post(`${apiRoot}/command`, () => {
        commands++;
        return authFailure();
      }),
      http.post(`${apiRoot}/auth/refresh`, () => {
        refreshes++;
        return HttpResponse.json(tokenResponse());
      }),
    );
    await expect(
      session.request('/command', {
        method: 'POST',
        body: {},
        idempotencyKey: 'original-operation-key',
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(commands).toBe(1);
    expect(refreshes).toBe(0);
  });
  it('preserves JSON, method, signal, If-Match and the original key on an approved replay', async () => {
    const { session } = await signedIn();
    const seen: unknown[] = [];
    const controller = new AbortController();
    server.use(
      http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse('rotated'))),
      http.patch(`${apiRoot}/command`, async ({ request }) => {
        seen.push({
          body: await request.json(),
          key: request.headers.get('Idempotency-Key'),
          match: request.headers.get('If-Match'),
          cancelled: request.signal.aborted,
        });
        return request.headers.get('Authorization') === 'Bearer rotated'
          ? HttpResponse.json({ data: true })
          : authFailure();
      }),
    );
    await session.request('/command', {
      method: 'PATCH',
      body: { amount: '10.25' },
      idempotencyKey: 'original-operation-key',
      ifMatch: '"4"',
      signal: controller.signal,
      replay: 'idempotent',
    });
    expect(seen).toEqual(
      Array(2).fill({
        body: { amount: '10.25' },
        key: 'original-operation-key',
        match: '"4"',
        cancelled: false,
      }),
    );
  });
  it('cancels a waiter without cancelling a shared refresh or replaying its request', async () => {
    const { session } = await signedIn();
    const gate = deferred();
    const started = deferred();
    let reads = 0;
    server.use(
      http.post(`${apiRoot}/auth/refresh`, async () => {
        started.resolve();
        await gate.promise;
        return HttpResponse.json(tokenResponse('rotated'));
      }),
      http.get(`${apiRoot}/sample`, ({ request }) => {
        reads++;
        return request.headers.get('Authorization') === 'Bearer rotated'
          ? HttpResponse.json({ data: true })
          : authFailure();
      }),
    );
    const controller = new AbortController();
    const cancelledRequest = session.request('/sample', { signal: controller.signal });
    const rejection = expect(cancelledRequest).rejects.toMatchObject({ name: 'AbortError' });
    const remaining = session.request('/sample');
    await started.promise;
    controller.abort();
    await rejection;
    gate.resolve();
    await remaining;
    expect(reads).toBe(3);
    expect(session.getSnapshot().status).toBe('authenticated');
  });
  it('prevents refresh from restoring a session after logout and orders cookie clearing last', async () => {
    const { session, query } = await signedIn();
    const gate = deferred();
    const started = deferred();
    const order: string[] = [];
    server.use(
      http.post(`${apiRoot}/auth/refresh`, async () => {
        started.resolve();
        await gate.promise;
        order.push('refresh-response');
        return HttpResponse.json(tokenResponse('late'));
      }),
      http.get(`${apiRoot}/sample`, () => authFailure()),
      http.post(`${apiRoot}/auth/logout`, () => {
        order.push('logout');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const pending = session.request('/sample');
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    const logout = session.logout();
    expect(session.getSnapshot().status).toBe('unauthenticated');
    gate.resolve();
    await logout;
    await rejection;
    expect(order).toEqual(['refresh-response', 'logout']);
    expect(query.getQueryData(currentUserKey)).toBeUndefined();
  });
  it('does not replay across a changed cookie account', async () => {
    const { session } = await signedIn();
    let reads = 0;
    server.use(
      http.get(`${apiRoot}/sample`, () => {
        reads++;
        return authFailure();
      }),
      http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse('other-account'))),
      http.get(`${apiRoot}/me`, () =>
        HttpResponse.json({ data: { ...testUser, id: 'e7538476-c904-4cca-8ea7-258c6943b397' } }),
      ),
    );
    await expect(session.request('/sample')).rejects.toThrow();
    expect(reads).toBe(1);
    expect(session.getSnapshot().status).toBe('unauthenticated');
  });
  it('keeps rotating auth endpoints outside recovery', async () => {
    const { session } = await signedIn();
    await expect(session.request('/auth/refresh')).rejects.toThrow(
      'Authentication commands use the session methods',
    );
  });
  it('holds new requests until refreshed account identity is verified', async () => {
    const { session } = await signedIn();
    const checking = deferred();
    const gate = deferred();
    let reads = 0;
    server.use(
      http.get(`${apiRoot}/sample`, () => {
        reads++;
        return authFailure();
      }),
      http.post(`${apiRoot}/auth/refresh`, () => HttpResponse.json(tokenResponse('other-account'))),
      http.get(`${apiRoot}/me`, async () => {
        checking.resolve();
        await gate.promise;
        return HttpResponse.json({
          data: { ...testUser, id: 'e7538476-c904-4cca-8ea7-258c6943b397' },
        });
      }),
    );
    const original = session.request('/sample');
    const rejection = expect(original).rejects.toThrow();
    await checking.promise;
    const next = session.request('/sample');
    const nextRejection = expect(next).rejects.toThrow();
    gate.resolve();
    await Promise.all([rejection, nextRejection]);
    expect(reads).toBe(1);
  });
});
