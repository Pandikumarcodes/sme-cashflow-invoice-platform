export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.accessToken',
  'req.body.refreshToken',
  'request.headers.authorization',
  'request.headers.cookie',
  'request.body.password',
  'request.body.accessToken',
  'request.body.refreshToken',
  'res.headers["set-cookie"]',
  'response.headers["set-cookie"]',
];
