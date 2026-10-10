import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../errors/application-error.js';
import { ERROR_CODES } from '../errors/error-codes.js';
import { requireTenantContext } from '../tenancy/tenant-context.js';
import { tenantResourceWhere, tenantWhere } from '../../database/helpers/tenant-query.js';

const OPERATIONS = new Set(['payment.record', 'payment.reverse', 'report.export']);
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(key))
    throw new ApplicationError(
      ERROR_CODES.INVALID_REQUEST,
      'Idempotency-Key must contain 16–128 non-whitespace printable ASCII characters.',
    );
  return key;
}

@Injectable()
export class IdempotencyService {
  async claim(client, tenant, operation, key, canonicalRequest) {
    requireTenantContext(tenant);
    validateIdempotencyKey(key);
    if (!OPERATIONS.has(operation))
      throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Unsupported idempotent operation.');
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          organizationId: tenant.organizationId,
          operation,
          request: canonicalRequest,
        }),
      )
      .digest('hex');
    const scope = { userId: tenant.userId, operation, key };
    const id = randomUUID();
    // The unique index arbitrates concurrent claims. A losing INSERT waits for
    // commit, then READ COMMITTED sees the completed claim. Rollback releases it.
    await client.idempotencyRecord.createMany({
      data: [
        {
          id,
          organizationId: tenant.organizationId,
          ...scope,
          requestHash,
          expiresAt: new Date(Date.now() + RETENTION_MS),
        },
      ],
      skipDuplicates: true,
    });
    const record = await client.idempotencyRecord.findFirst({ where: tenantWhere(tenant, scope) });
    if (
      !record ||
      record.requestHash !== requestHash ||
      (record.id !== id && record.status !== 'COMPLETED')
    )
      throw new ApplicationError(
        ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'Idempotency key conflicts with this request.',
      );
    return { record, replayed: record.id !== id };
  }

  complete(client, tenant, record, resourceId, httpStatus, resourceType = 'Payment') {
    requireTenantContext(tenant);
    return client.idempotencyRecord.update({
      where: {
        ...tenantResourceWhere(tenant, record.id),
        userId: tenant.userId,
        status: 'PROCESSING',
      },
      data: { status: 'COMPLETED', resourceType, resourceId, httpStatus },
    });
  }
}
