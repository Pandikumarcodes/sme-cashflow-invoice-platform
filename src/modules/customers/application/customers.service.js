import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  requireTenantResource,
  tenantResourceWhere,
  tenantWhere,
} from '../../../database/helpers/tenant-query.js';
import { toCustomerResponse } from '../customer-response.js';
import {
  customerListOptions,
  customerListFilter,
  decodeCustomerCursor,
  encodeCustomerCursor,
} from './customer-pagination.js';

const WRITABLE_FIELDS = ['displayName', 'customerCode', 'email'];

@Injectable()
export class CustomersService {
  constructor(prismaService, authorization) {
    this.prismaService = prismaService;
    this.authorization = authorization;
  }

  async resolve(client, context, permission) {
    requireTenantContext(context);
    return resolveTenantAccess(client, context, context.organizationId, this.authorization, [
      permission,
    ]);
  }

  async create(context, input, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    try {
      const customer = await prisma.$transaction(async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.CUSTOMER_CREATE);
        const created = await tx.customer.create({
          data: {
            ...this.writableData(input),
            organizationId: tenant.organizationId,
            createdByUserId: tenant.userId,
          },
        });
        await this.audit(
          tx,
          tenant,
          'CUSTOMER_CREATED',
          created.id,
          null,
          this.snapshot(created),
          WRITABLE_FIELDS.filter((field) => input[field] !== undefined),
          metadata,
        );
        return created;
      });
      return toCustomerResponse(customer);
    } catch (error) {
      this.rethrowPersistenceError(error);
    }
  }

  async list(context, query = {}) {
    const prisma = await this.prismaService.getClient();
    const { tenant } = await this.resolve(prisma, context, PERMISSIONS.CUSTOMER_READ);
    const options = customerListOptions(tenant.organizationId, query);
    const key = decodeCustomerCursor(query.after, options);
    const rows = await prisma.customer.findMany({
      where: tenantWhere(tenant, customerListFilter(options, key)),
      orderBy: [{ [options.sortBy]: options.sortOrder }, { id: options.sortOrder }],
      take: options.limit + 1,
    });
    const hasMore = rows.length > options.limit;
    const page = rows.slice(0, options.limit);
    return {
      data: page.map(toCustomerResponse),
      meta: {
        limit: options.limit,
        nextCursor: hasMore ? encodeCustomerCursor(page.at(-1), options) : null,
        hasMore,
      },
    };
  }

  async get(context, customerId) {
    const prisma = await this.prismaService.getClient();
    const { tenant } = await this.resolve(prisma, context, PERMISSIONS.CUSTOMER_READ);
    return toCustomerResponse(await this.findCustomer(prisma, tenant, customerId));
  }

  async update(context, customerId, expectedVersion, input, metadata = {}) {
    const data = this.writableData(input);
    if (!Object.keys(data).length) {
      throw new ApplicationError(
        ERROR_CODES.INVALID_REQUEST,
        'At least one customer field is required.',
      );
    }
    const prisma = await this.prismaService.getClient();
    try {
      const customer = await prisma.$transaction(async (tx) => {
        const { tenant } = await this.resolve(tx, context, PERMISSIONS.CUSTOMER_UPDATE);
        const before = await this.findCustomer(tx, tenant, customerId);
        const changed = await tx.customer.updateMany({
          where: { ...tenantResourceWhere(tenant, customerId), version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (changed.count !== 1) throw this.concurrentModification();
        const updated = await this.findCustomer(tx, tenant, customerId);
        await this.audit(
          tx,
          tenant,
          'CUSTOMER_UPDATED',
          updated.id,
          this.snapshot(before),
          this.snapshot(updated),
          Object.keys(data),
          metadata,
        );
        return updated;
      });
      return toCustomerResponse(customer);
    } catch (error) {
      this.rethrowPersistenceError(error);
    }
  }

  async archive(context, customerId, metadata = {}) {
    const prisma = await this.prismaService.getClient();
    const customer = await prisma.$transaction(async (tx) => {
      const { tenant } = await this.resolve(tx, context, PERMISSIONS.CUSTOMER_ARCHIVE);
      const before = await this.findCustomer(tx, tenant, customerId);
      if (before.status === 'ARCHIVED') return before;
      const changed = await tx.customer.updateMany({
        where: {
          ...tenantResourceWhere(tenant, customerId),
          status: 'ACTIVE',
          version: before.version,
        },
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      });
      const updated = await this.findCustomer(tx, tenant, customerId);
      if (changed.count !== 1) {
        if (updated.status === 'ARCHIVED') return updated;
        throw this.concurrentModification();
      }
      await this.audit(
        tx,
        tenant,
        'CUSTOMER_ARCHIVED',
        updated.id,
        { status: before.status, version: before.version },
        { status: updated.status, version: updated.version },
        ['status'],
        metadata,
      );
      return updated;
    });
    return toCustomerResponse(customer);
  }

  async findCustomer(client, tenant, customerId) {
    return requireTenantResource(
      await client.customer.findFirst({
        where: tenantResourceWhere(tenant, customerId),
      }),
      'Customer',
    );
  }

  writableData(input) {
    const data = {};
    for (const field of WRITABLE_FIELDS) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    return data;
  }

  snapshot(customer) {
    return {
      displayName: customer.displayName,
      customerCode: customer.customerCode,
      email: customer.email,
      status: customer.status,
      version: customer.version,
    };
  }

  concurrentModification() {
    return new ApplicationError(
      ERROR_CODES.CONCURRENT_MODIFICATION,
      'Customer version does not match.',
    );
  }

  rethrowPersistenceError(error) {
    if (error?.code === 'P2002') {
      throw new ApplicationError(
        ERROR_CODES.CUSTOMER_CODE_UNAVAILABLE,
        'Customer code is unavailable.',
      );
    }
    throw error;
  }

  audit(tx, tenant, action, entityId, beforeData, afterData, changedFields, metadata) {
    return tx.auditLog.create({
      data: {
        organizationId: tenant.organizationId,
        actorType: 'USER',
        actorUserId: tenant.userId,
        actorMembershipId: tenant.membershipId,
        actorSessionId: tenant.sessionId,
        source: 'API',
        outcome: 'SUCCESS',
        action,
        entityType: 'Customer',
        entityId,
        beforeData,
        afterData,
        changedFields,
        requestId: metadata.requestId,
        correlationId: metadata.correlationId,
      },
    });
  }
}
Inject(PrismaService)(CustomersService, undefined, 0);
Inject(AuthorizationService)(CustomersService, undefined, 1);
