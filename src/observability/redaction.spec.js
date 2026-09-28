import { LOG_REDACT_PATHS } from './redaction.js';

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
