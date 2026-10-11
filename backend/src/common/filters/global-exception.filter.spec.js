import { jest } from '@jest/globals';
import { GlobalExceptionFilter } from './global-exception.filter.js';
it('keeps exception and request secrets out of error logs and responses', () => {
  const filter = new GlobalExceptionFilter({ get: () => ({ requestId: 'request-1' }) });
  filter.logger = { error: jest.fn() };
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  filter.catch(new Error('SELECT password SECRET'), {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/secret/SECRET', route: { path: '/safe/:id' } }),
      getResponse: () => response,
    }),
  });
  expect(JSON.stringify(filter.logger.error.mock.calls)).not.toContain('SECRET');
  expect(JSON.stringify(response.json.mock.calls)).not.toContain('SECRET');
  expect(filter.logger.error).toHaveBeenCalledWith(
    expect.objectContaining({ route: '/safe/:id', code: 'INTERNAL_ERROR' }),
  );
});
