import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import {
  requireTenantContext,
  resolveTenantAccess,
} from '../../../common/tenancy/tenant-context.js';
import { tenantWhere, requireTenantResource } from '../../../database/helpers/tenant-query.js';
import { ApplicationError } from '../../../common/errors/application-error.js';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service.js';
import { ReportReader } from '../../financial/infrastructure/report-reader.js';
import { ReportStorage } from '../infrastructure/report-storage.js';
import { ReportPersistence } from '../infrastructure/report-persistence.js';
import {
  REPORT_EVENT,
  REQUEST_SCHEMA,
  PAGE_SCHEMA,
  LIST_SCHEMA,
  parse,
  reportOptions,
  cursorScope,
  encodeCursor,
  decodeCursor,
  exportResponse,
} from '../domain/report.js';
import { reportFileName } from '../domain/csv.js';

@Injectable()
export class ReportsService {
  constructor(persistence, authorization, reader, storage, exports, idempotency) {
    Object.assign(this, { persistence, authorization, reader, storage, exports, idempotency });
  }
  async transaction(context, permission, action, readOnly = false) {
    requireTenantContext(context);
    const client = await this.persistence.getClient();
    return client.$transaction(
      async (tx) => {
        if (readOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const scope = await resolveTenantAccess(
          tx,
          context,
          context.organizationId,
          this.authorization,
          [permission],
        );
        return action(tx, scope.tenant, scope.membership.organization);
      },
      { isolationLevel: readOnly ? 'RepeatableRead' : 'ReadCommitted', timeout: 15000 },
    );
  }
  preview(context, type, query) {
    return this.transaction(
      context,
      PERMISSIONS.REPORT_READ,
      async (tx, tenant, org) => {
        const { limit, after, ...parameters } = query;
        parse(PAGE_SCHEMA, {
          ...(limit === undefined ? {} : { limit }),
          ...(after === undefined ? {} : { after }),
        });
        const options = reportOptions(type, parameters, org);
        const signature = cursorScope(tenant.organizationId, type, options);
        const cursor = decodeCursor(after, signature, false, type === 'RECEIVABLES');
        const size = Number(limit ?? 25);
        const all = await this.reader.read(tx, tenant, type, options, org, size + 1, cursor?.id);
        const hasMore = all.length > size;
        const page = all.slice(0, size);
        const last = type === 'RECEIVABLES' ? { id: page.at(-1)?.bucket } : page.at(-1);
        return {
          data: page,
          meta: {
            ...options,
            currency: org.baseCurrency,
            timezone: org.timezone,
            basis: 'CURRENT_STATE',
            limit: size,
            hasMore,
            nextCursor: hasMore ? encodeCursor(last, signature) : null,
          },
        };
      },
      true,
    );
  }
  request(context, input, key, metadata = {}) {
    return this.transaction(context, PERMISSIONS.REPORT_EXPORT, async (tx, tenant, org) => {
      const command = parse(REQUEST_SCHEMA, input);
      const parameters = reportOptions(command.reportType, command.parameters, org);
      // Canonical field order makes optional idempotency independent of JSON key order.
      const canonical = {
        reportType: command.reportType,
        format: 'CSV',
        parameters: Object.fromEntries(
          Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)),
        ),
      };
      const claim =
        key === undefined
          ? null
          : await this.idempotency.claim(tx, tenant, 'report.export', key, canonical);
      if (claim?.replayed) {
        const row = requireTenantResource(
          await this.exports.find(tx, tenant, claim.record.resourceId),
          'ReportExport',
        );
        return { data: exportResponse(row), replayed: true };
      }
      const row = await tx.reportExport.create({
        data: {
          organizationId: tenant.organizationId,
          requestedByUserId: tenant.userId,
          ...canonical,
        },
      });
      await this.exports.audit(tx, tenant, row, 'report.export.request', metadata);
      await tx.pendingEvent.create({
        data: {
          organizationId: tenant.organizationId,
          aggregateType: 'ReportExport',
          aggregateId: row.id,
          eventType: REPORT_EVENT,
          eventVersion: 1,
          payload: { version: 1, organizationId: tenant.organizationId, exportId: row.id },
        },
      });
      if (claim)
        await this.idempotency.complete(tx, tenant, claim.record, row.id, 202, 'ReportExport');
      return { data: exportResponse(row), replayed: false };
    });
  }
  list(context, query) {
    return this.transaction(context, PERMISSIONS.REPORT_EXPORT, async (tx, tenant) => {
      await this.expire(tx, tenant);
      const { limit = '25', after, ...filters } = parse(LIST_SCHEMA, query);
      const signature = cursorScope(tenant.organizationId, 'exports', filters);
      const cursor = decodeCursor(after, signature, true);
      const where = tenantWhere(tenant, {
        ...filters,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      });
      const rows = await tx.reportExport.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Number(limit) + 1,
      });
      const hasMore = rows.length > Number(limit),
        page = rows.slice(0, Number(limit));
      return {
        data: page.map((row) => exportResponse(row)),
        meta: {
          limit: Number(limit),
          hasMore,
          nextCursor: hasMore ? encodeCursor(page.at(-1), signature, 'createdAt') : null,
        },
      };
    });
  }
  detail(context, id) {
    return this.transaction(context, PERMISSIONS.REPORT_EXPORT, async (tx, tenant) => {
      await this.expire(tx, tenant);
      const row = requireTenantResource(await this.exports.find(tx, tenant, id), 'ReportExport');
      return { data: exportResponse(row) };
    });
  }
  expire(tx, tenant) {
    return tx.reportExport.updateMany({
      where: tenantWhere(tenant, { status: 'READY', expiresAt: { lte: new Date() } }),
      data: { status: 'EXPIRED' },
    });
  }
  async download(context, id, metadata = {}) {
    const row = await this.transaction(context, PERMISSIONS.REPORT_EXPORT, async (tx, tenant) => {
      await this.expire(tx, tenant);
      const row = requireTenantResource(await this.exports.find(tx, tenant, id), 'ReportExport');
      return row;
    });
    if (row.status === 'EXPIRED' || (row.expiresAt && row.expiresAt <= new Date()))
      throw new ApplicationError('EXPORT_EXPIRED', 'Export has expired.');
    if (row.status !== 'READY')
      throw new ApplicationError('EXPORT_NOT_READY', 'Export is not ready.');
    let bytes;
    try {
      bytes = await this.storage.read(row.storageObjectKey, row.checksum, row.organizationId);
    } catch {
      throw new ApplicationError('EXPORT_ARTIFACT_UNAVAILABLE', 'Export artifact is unavailable.');
    }
    // File I/O occurs outside the transaction. Recheck access/expiry before auditing release.
    await this.transaction(context, PERMISSIONS.REPORT_EXPORT, async (tx, tenant) => {
      const current = requireTenantResource(
        await this.exports.find(tx, tenant, id),
        'ReportExport',
      );
      if (current.expiresAt <= new Date() || current.status === 'EXPIRED')
        throw new ApplicationError('EXPORT_EXPIRED', 'Export has expired.');
      if (current.status !== 'READY' || current.checksum !== row.checksum)
        throw new ApplicationError('EXPORT_NOT_READY', 'Export is not ready.');
      await this.exports.audit(tx, tenant, row, 'report.export.download', metadata);
    });
    return { bytes, filename: reportFileName(row) };
  }
}
Inject(PrismaService)(ReportsService, undefined, 0);
Inject(AuthorizationService)(ReportsService, undefined, 1);
Inject(ReportReader)(ReportsService, undefined, 2);
Inject(ReportStorage)(ReportsService, undefined, 3);
Inject(ReportPersistence)(ReportsService, undefined, 4);
Inject(IdempotencyService)(ReportsService, undefined, 5);
