import { EventEmitter } from 'node:events';
import pinoHttp from 'pino-http';
import { LOG_REDACT_PATHS, SAFE_HTTP_SERIALIZERS } from './redaction.js';

describe('log redaction', () => {
  it('redacts credential-bearing fields for the configured Pino request/response names', () => {
    expect(LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'request.headers.authorization',
        'request.headers.cookie',
        'request.body.password',
        'request.body.refreshToken',
        'response.headers["set-cookie"]',
      ]),
    );
  });
});

it('omits raw URLs, headers, bodies, and exception contents from HTTP serialization', () => {
  const secret = 'SECRET';
  const output = {
    request: SAFE_HTTP_SERIALIZERS.req({
      id: 'r1',
      method: 'GET',
      url: '/?token=' + secret,
      headers: { 'x-api-key': secret },
      body: { report: secret },
      raw: { route: { path: '/safe/:id' } },
    }),
    response: SAFE_HTTP_SERIALIZERS.res({ statusCode: 500, headers: { 'set-cookie': secret } }),
    error: SAFE_HTTP_SERIALIZERS.err(new Error(secret)),
  };
  expect(JSON.stringify(output)).not.toContain(secret);
  expect(output.request.route).toBe('/safe/:id');
});

it('keeps secrets out of actual Pino HTTP output with custom attribute keys', () => {
  const lines = [];
  const middleware = pinoHttp(
    {
      autoLogging: false,
      serializers: SAFE_HTTP_SERIALIZERS,
      customAttributeKeys: { req: 'request', res: 'response' },
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    },
    { write: (line) => lines.push(line) },
  );
  const req = new EventEmitter();
  Object.assign(req, {
    id: 'request-1',
    method: 'POST',
    url: '/?token=SECRET',
    headers: { authorization: 'SECRET', 'x-api-key': 'SECRET' },
    body: { password: 'SECRET' },
    route: { path: '/safe/:id' },
    socket: {},
  });
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 500, getHeaders: () => ({ 'set-cookie': 'SECRET' }) });
  middleware(req, res);
  req.log.error({ err: new Error('SECRET SQL'), response: res }, 'request failed');
  expect(lines.join('')).not.toContain('SECRET');
  const entry = JSON.parse(lines[0]);
  expect(entry.request).toEqual({ id: 'request-1', method: 'POST', route: '/safe/:id' });
  expect(entry.err).toEqual({ type: 'HTTP_ERROR' });
});
