import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service.js';
import { AuthorizationService } from '../../../common/authorization/authorization.service.js';
import { PERMISSIONS } from '../../../common/authorization/permissions.js';
import { resolveTenantAccess } from '../../../common/tenancy/tenant-context.js';
import { ReportReader } from '../../financial/infrastructure/report-reader.js';
import { ReportReadyNotifier } from '../../notifications/application/report-ready-notifier.js';
import { ReportStorage } from '../infrastructure/report-storage.js';
import { ReportPersistence } from '../infrastructure/report-persistence.js';
import { JOB_SCHEMA, EVENT_SCHEMA, REPORT_EVENT, reportOptions } from '../domain/report.js';
import { csvArtifact, COLUMNS } from '../domain/csv.js';

const PERMANENT = new Set([
  'INVALID_REQUEST',
  'CURRENCY_MISMATCH',
  'INVOICE_SETTLEMENT_INCONSISTENT',
  'REPORT_TOO_LARGE',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
]);
@Injectable()
export class ReportGenerationService {
  constructor(persistence, authorization, reader, storage, exports, notifier, config) {
    Object.assign(this, { persistence, authorization, reader, storage, exports, notifier });
    this.lifetimeHours = config.get('REPORT_EXPIRY_HOURS') ?? 24;
    this.clock = () => new Date();
  }
  async requester(tx, row) {
    const user = await tx.user.findFirst({
      where: { id: row.requestedByUserId, status: 'ACTIVE' },
    });
    if (!user) throw Object.assign(new Error('REPORT_ACCESS_REVOKED'), { code: 'FORBIDDEN' });
    return resolveTenantAccess(
      tx,
      { userId: user.id, sessionId: 'report-worker' },
      row.organizationId,
      this.authorization,
      [PERMISSIONS.REPORT_EXPORT],
    );
  }
  async handleEvent(input) {
    const parsed = JOB_SCHEMA.safeParse(input);
    if (!parsed.success) return;
    const job = parsed.data,
      client = await this.persistence.getClient();
    const claim = await client.$transaction(async (tx) => {
      const [event] =
        await tx.$queryRaw`SELECT * FROM pending_events WHERE id = ${job.eventId}::uuid AND "organizationId" = ${job.organizationId}::uuid FOR UPDATE`;
      if (!event || ['PROCESSED', 'FAILED'].includes(event.status)) return null;
      if (event.eventType !== REPORT_EVENT) return null;
      const payload = EVENT_SCHEMA.safeParse(event.payload);
      if (
        event.eventVersion !== 1 ||
        event.aggregateType !== 'ReportExport' ||
        !payload.success ||
        payload.data.organizationId !== job.organizationId ||
        payload.data.exportId !== event.aggregateId
      ) {
        await tx.pendingEvent.updateMany({
          where: { id: event.id, organizationId: job.organizationId },
          data: { status: 'FAILED', lastErrorCode: 'INVALID_REPORT_EVENT', claimedAt: null },
        });
        return null;
      }
      const row = await this.exports.lock(tx, job.organizationId, payload.data.exportId);
      if (!row || ['READY', 'FAILED', 'EXPIRED'].includes(row.status)) {
        await tx.pendingEvent.updateMany({
          where: { id: event.id, organizationId: job.organizationId },
          data: {
            status: row?.status === 'FAILED' ? 'FAILED' : 'PROCESSED',
            processedAt: this.clock(),
            claimedAt: null,
          },
        });
        return null;
      }
      const now = this.clock();
      if (row.status === 'RUNNING' && row.updatedAt > new Date(now.getTime() - 60000)) return null;
      const attempt = Number(/^REPORT_ATTEMPT_([1-3])$/.exec(row.errorCode ?? '')?.[1] ?? 0) + 1;
      if (attempt > 3) {
        await this.failed(tx, job, row.id, 'REPORT_ATTEMPTS_EXHAUSTED');
        return null;
      }
      try {
        await this.requester(tx, row);
      } catch (error) {
        if (!['FORBIDDEN', 'RESOURCE_NOT_FOUND'].includes(error.code)) throw error;
        await this.failed(tx, job, row.id, 'REPORT_ACCESS_REVOKED');
        return null;
      }
      await tx.reportExport.updateMany({
        where: { id: row.id, organizationId: job.organizationId },
        data: { status: 'RUNNING', updatedAt: now, errorCode: `REPORT_ATTEMPT_${attempt}` },
      });
      await tx.pendingEvent.updateMany({
        where: { id: event.id, organizationId: job.organizationId },
        data: { status: 'PROCESSING', claimedAt: now, lastErrorCode: null },
      });
      return { row, token: now, attempt };
    });
    if (!claim) return;
    let artifact;
    try {
      const rows = await client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          const { tenant, membership } = await this.requester(tx, claim.row);
          if (claim.row.format !== 'CSV')
            throw Object.assign(new Error('Unsupported format'), { code: 'INVALID_REQUEST' });
          const options = reportOptions(
            claim.row.reportType,
            claim.row.parameters,
            membership.organization,
          );
          return this.reader.read(
            tx,
            tenant,
            claim.row.reportType,
            options,
            membership.organization,
          );
        },
        { isolationLevel: 'RepeatableRead', timeout: 15000 },
      );
      const bytes = csvArtifact(COLUMNS[claim.row.reportType], rows);
      artifact = await this.storage.write(job.organizationId, bytes);
      const saved = await client.$transaction(async (tx) => {
        await this.lockEvent(tx, job);
        const row = await this.exports.lock(tx, job.organizationId, claim.row.id);
        if (row.status !== 'RUNNING' || row.updatedAt.getTime() !== claim.token.getTime())
          return false;
        const { tenant } = await this.requester(tx, row);
        const completedAt = this.clock();
        await tx.reportExport.updateMany({
          where: { id: row.id, organizationId: job.organizationId },
          data: {
            status: 'READY',
            storageObjectKey: artifact.key,
            checksum: artifact.checksum,
            rowCount: BigInt(rows.length),
            errorCode: null,
            completedAt,
            expiresAt: new Date(completedAt.getTime() + this.lifetimeHours * 3600000),
          },
        });
        await this.notifier.append(tx, tenant, row.id);
        await tx.pendingEvent.updateMany({
          where: { id: job.eventId, organizationId: job.organizationId },
          data: {
            status: 'PROCESSED',
            processedAt: completedAt,
            claimedAt: null,
            lastErrorCode: null,
          },
        });
        return true;
      });
      if (!saved) await this.storage.discard(artifact.key);
    } catch (error) {
      // Stable codes only: no ORM/provider/path details become report metadata.
      const permanent = PERMANENT.has(error.code);
      const code =
        error.code === 'FORBIDDEN' || error.code === 'RESOURCE_NOT_FOUND'
          ? 'REPORT_ACCESS_REVOKED'
          : permanent
            ? error.code
            : 'REPORT_GENERATION_UNAVAILABLE';
      const keepArtifact = await client.$transaction(async (tx) => {
        await this.lockEvent(tx, job);
        const row = await this.exports.lock(tx, job.organizationId, claim.row.id);
        // A connection failure can hide a successful completion commit. Never
        // remove an artifact referenced by durable READY/EXPIRED metadata.
        if (
          artifact &&
          ['READY', 'EXPIRED'].includes(row.status) &&
          row.storageObjectKey === artifact.key
        )
          return true;
        if (row.status !== 'RUNNING' || row.updatedAt.getTime() !== claim.token.getTime()) return;
        if (permanent || claim.attempt >= 3)
          await this.failed(tx, job, row.id, permanent ? code : 'REPORT_ATTEMPTS_EXHAUSTED');
        else {
          await tx.reportExport.updateMany({
            where: { id: row.id, organizationId: job.organizationId },
            data: { status: 'PENDING' },
          });
          await tx.pendingEvent.updateMany({
            where: { id: job.eventId, organizationId: job.organizationId },
            data: {
              status: 'PENDING',
              claimedAt: null,
              availableAt: new Date(this.clock().getTime() + 2 ** claim.attempt * 1000),
              lastErrorCode: code,
            },
          });
        }
      });
      if (artifact && !keepArtifact) await this.storage.discard(artifact.key);
      if (keepArtifact) return;
      if (!permanent && claim.attempt < 3) throw new Error('REPORT_RETRY');
    }
  }
  async failed(tx, job, id, code) {
    await tx.reportExport.updateMany({
      where: { id, organizationId: job.organizationId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'FAILED', errorCode: code, completedAt: this.clock() },
    });
    await tx.pendingEvent.updateMany({
      where: { id: job.eventId, organizationId: job.organizationId },
      data: { status: 'FAILED', claimedAt: null, lastErrorCode: code },
    });
  }
  lockEvent(tx, job) {
    return tx.$queryRaw`SELECT id FROM pending_events WHERE id = ${job.eventId}::uuid AND "organizationId" = ${job.organizationId}::uuid FOR UPDATE`;
  }
}
Inject(PrismaService)(ReportGenerationService, undefined, 0);
Inject(AuthorizationService)(ReportGenerationService, undefined, 1);
Inject(ReportReader)(ReportGenerationService, undefined, 2);
Inject(ReportStorage)(ReportGenerationService, undefined, 3);
Inject(ReportPersistence)(ReportGenerationService, undefined, 4);
Inject(ReportReadyNotifier)(ReportGenerationService, undefined, 5);
Inject(ConfigService)(ReportGenerationService, undefined, 6);
