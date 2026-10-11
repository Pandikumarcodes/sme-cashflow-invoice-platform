export const LOG_REDACT_PATHS = [
  'req.body',
  'request.body',
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

export const SAFE_HTTP_SERIALIZERS = {
  req: (request) => ({
    id: request.id,
    method: request.method,
    route: request.raw?.route?.path ?? 'unmatched',
  }),
  res: (response) => ({ statusCode: response.statusCode }),
  err: () => ({ type: 'HTTP_ERROR' }),
};
