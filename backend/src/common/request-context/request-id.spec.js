import { resolveRequestId } from './request-id.js';
describe('resolveRequestId', () => {
  it('accepts a valid UUID request ID', () => {
    const requestId = '5a8ef949-935d-4c40-9464-6efbd4457c1c';
    expect(resolveRequestId(requestId)).toEqual({ requestId, source: 'external' });
  });
  it.each(['unsafe value', 'value\r\ninjected', '', 'x'.repeat(65)])(
    'replaces an unsafe request ID: %s',
    (requestId) => {
      const result = resolveRequestId(requestId);
      expect(result.source).toBe('generated');
      expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
