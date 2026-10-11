import { http, HttpResponse } from 'msw';
import type { User } from '../auth/contracts';

export const apiRoot = 'http://localhost:3000/api/v1';
export const testUser: User = {
  id: 'f64bdb6e-7b52-4cf7-8184-7c364ed179a1',
  email: 'alex@example.test',
  firstName: 'Alex',
  lastName: 'Morgan',
  status: 'ACTIVE',
  emailVerifiedAt: null,
  lastLoginAt: '2026-10-11T10:00:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
};
export const loginInput = { email: testUser.email, password: 'a-private-password' };
export function tokenResponse(accessToken = 'memory-access-token') {
  return { data: { accessToken, tokenType: 'Bearer', expiresIn: 900 } };
}
export function authFailure(code = 'UNAUTHENTICATED', status = 401) {
  return HttpResponse.json(
    { error: { code, message: 'Private server text', requestId: 'auth-request-id' } },
    { status },
  );
}
export function authHandlers() {
  return [
    http.post(`${apiRoot}/auth/refresh`, () => authFailure('INVALID_SESSION')),
    http.post(`${apiRoot}/auth/login`, () =>
      HttpResponse.json({ data: { ...tokenResponse().data, user: testUser } }),
    ),
    http.post(`${apiRoot}/auth/register`, () =>
      HttpResponse.json({ data: testUser }, { status: 201 }),
    ),
    http.post(`${apiRoot}/auth/logout`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${apiRoot}/me`, () => HttpResponse.json({ data: testUser })),
  ];
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
