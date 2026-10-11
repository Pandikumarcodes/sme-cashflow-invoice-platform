import { jest } from '@jest/globals';
import { IdempotencyService, validateIdempotencyKey } from './idempotency.service.js';
import { resolveTenantAccess } from '../tenancy/tenant-context.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { PERMISSIONS } from '../authorization/permissions.js';

describe('transaction-bound idempotency', () => {
  it.each([
    undefined,
    '',
    'short',
    'a'.repeat(129),
    'a'.repeat(15) + ' ',
    'a'.repeat(15) + '\n',
    'a'.repeat(15) + 'é',
  ])('rejects invalid keys %s', (key) => {
    expect(() => validateIdempotencyKey(key)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });
  it('validates printable keys and claims/completes/replays without a response blob', async () => {
    const service = new IdempotencyService();
    let record;
    const client = {
      membership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ organizationId: 'tenant', role: 'OWNER', id: 'member' }),
      },
      idempotencyRecord: {
        createMany: jest.fn(({ data }) => {
          record ??= { ...data[0], status: 'PROCESSING' };
          return Promise.resolve({ count: 1 });
        }),
        findFirst: jest.fn(async () => record),
        update: jest.fn(({ data }) => {
          record = { ...record, ...data };
          return Promise.resolve(record);
        }),
      },
    };
    const { tenant } = await resolveTenantAccess(
      client,
      { userId: 'user', sessionId: 'session' },
      'tenant',
      new AuthorizationService(),
      [PERMISSIONS.PAYMENT_CREATE],
    );
    const key = validateIdempotencyKey('payment-key-123456');
    const claim = await service.claim(client, tenant, 'payment.record', key, {
      amount: '10',
      invoiceId: 'id',
    });
    expect(claim.replayed).toBe(false);
    expect(claim.record.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 86400000);
    await service.complete(client, tenant, claim.record, 'payment-id', 201);
    expect(
      (
        await service.claim(client, tenant, 'payment.record', key, {
          amount: '10',
          invoiceId: 'id',
        })
      ).replayed,
    ).toBe(true);
    await expect(
      service.claim(client, tenant, 'payment.record', key, { amount: '11', invoiceId: 'id' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(record).toMatchObject({
      resourceId: 'payment-id',
      httpStatus: 201,
      status: 'COMPLETED',
    });
    expect(record.response).toBeUndefined();
    await expect(
      service.claim(client, { ...tenant }, 'payment.record', key, {}),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
