import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { clearDatabase, createTestPrismaClient } from './database-test-helpers.js';
import { notificationFixture } from '../helpers/notification-fixture.js';
import { reportFixture, command, REPORT_RANGE, exportJob } from '../helpers/report-fixture.js';
import { ExpensesService } from '../../src/modules/expenses/application/expenses.service.js';
import { OrganizationInvoiceSettings } from '../../src/modules/organizations/application/organization-invoice-settings.js';

jest.setTimeout(30000);
describe('report exports PostgreSQL lifecycle and financial reconciliation', () => {
  const prisma = createTestPrismaClient();
  let a, b, r;
  beforeEach(async () => {
    await clearDatabase(prisma);
    a = await notificationFixture(prisma, 'reports-a');
    b = await notificationFixture(prisma, 'reports-b');
    r = reportFixture(a);
  });
  afterEach(async () => r?.cleanup());
  afterAll(async () => prisma.$disconnect());
  const request = (type) => r.reports.request(a.tenant, command(type));
  const row = (id) =>
    prisma.reportExport.findFirstOrThrow({ where: { id, organizationId: a.org.id } });
  const payment = (amount = '0.30') =>
    a.payments.record(
      a.tenant,
      a.invoice.id,
      { amount, paymentDate: '2026-01-15', method: 'BANK_TRANSFER' },
      randomUUID(),
    );
  it('creates export, audit, and IDs-only event atomically; optional concurrent keys execute once', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      r.reports.request(a.tenant, command(), key),
      r.reports.request(a.tenant, command(), key),
    ]);
    expect(results[0].data.id).toBe(results[1].data.id);
    expect(results.filter((result) => result.replayed)).toHaveLength(1);
    expect(await prisma.reportExport.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'report.export.request' } })).toBe(1);
    const event = await prisma.pendingEvent.findFirstOrThrow({
      where: { eventType: 'REPORT_EXPORT_REQUESTED' },
    });
    expect(event.payload).toEqual({
      version: 1,
      organizationId: a.org.id,
      exportId: results[0].data.id,
    });
    await expect(r.reports.request(a.tenant, command('CASH_FLOW'), key)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await request();
    await request();
    expect(await prisma.reportExport.count()).toBe(3);
  });
  it('rolls back the export and claim when the required audit fails', async () => {
    const key = randomUUID(),
      audit = r.reports.exports.audit;
    r.reports.exports.audit = async () => {
      throw new Error('simulated audit failure');
    };
    await expect(r.reports.request(a.tenant, command(), key)).rejects.toThrow();
    expect(await prisma.reportExport.count()).toBe(0);
    expect(await prisma.idempotencyRecord.count()).toBe(0);
    expect(
      await prisma.pendingEvent.count({ where: { eventType: 'REPORT_EXPORT_REQUESTED' } }),
    ).toBe(0);
    r.reports.exports.audit = audit;
  });
  it('generates all six deterministic CSVs and replays completed work without changing files or financial facts', async () => {
    await payment();
    const before = await prisma.invoice.findMany({ orderBy: { id: 'asc' } });
    for (const type of [
      'INVOICE_REGISTER',
      'PAYMENT_REGISTER',
      'EXPENSE_REGISTER',
      'RECEIVABLES',
      'CASH_FLOW',
      'CASH_BASIS_PERFORMANCE',
    ]) {
      const { data } = await request(type),
        job = await exportJob(prisma, data);
      await Promise.all([r.generation.handleEvent(job), r.generation.handleEvent(job)]);
      const completed = await row(data.id);
      expect(completed.status).toBe('READY');
      expect(completed.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(completed.expiresAt - completed.completedAt).toBe(86400000);
      const download = await r.reports.download(a.tenant, data.id);
      expect(download.filename).toMatch(/\.csv$/);
      expect(download.bytes.toString()).toContain('\r\n');
      await r.generation.handleEvent(job);
      expect(await row(data.id)).toEqual(completed);
      expect(
        await prisma.notification.count({
          where: { relatedEntityId: data.id, type: 'REPORT_READY' },
        }),
      ).toBe(1);
    }
    expect(await prisma.invoice.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: 'report.export.download' } })).toBe(6);
  });
  it('reconciles registers, cash and aging using current facts after reversals/voids and archived dimensions', async () => {
    const paid = await payment();
    const category = await prisma.expenseCategory.findFirstOrThrow({
      where: { organizationId: a.org.id },
    });
    const expenses = new ExpensesService(
      a.provider,
      a.authorization,
      new OrganizationInvoiceSettings(),
    );
    const expense = await expenses.create(a.tenant, {
      categoryId: category.id,
      amount: '0.10',
      expenseDate: '2026-01-15',
      vendorPayee: '=1+1',
      description: 'Quoted, "work"\nதமிழ்',
    });
    await prisma.customer.update({ where: { id: a.customer.id }, data: { status: 'ARCHIVED' } });
    await prisma.expenseCategory.update({
      where: { id: category.id },
      data: { status: 'ARCHIVED' },
    });
    const invoice = await r.reports.preview(a.tenant, 'INVOICE_REGISTER', {
      ...REPORT_RANGE,
      asOfDate: '2026-02-01',
    });
    expect(invoice.data[0]).toMatchObject({
      total: '1000.00',
      paid: '0.30',
      balance: '999.70',
      overdue: true,
    });
    const cash = await r.reader.read(
      prisma,
      a.tenant,
      'CASH_FLOW',
      { ...REPORT_RANGE, groupBy: 'month' },
      a.org,
    );
    expect(cash[0]).toMatchObject({ inflows: '0.30', outflows: '0.10', netCashFlow: '0.20' });
    const { data } = await request('EXPENSE_REGISTER');
    await r.generation.handleEvent(await exportJob(prisma, data));
    expect((await r.reports.download(a.tenant, data.id)).bytes.toString()).toContain("'=1+1");
    await a.payments.reverse(
      a.tenant,
      paid.data.id,
      { reason: 'Correction', reversalDate: '2026-01-16' },
      randomUUID(),
    );
    await expenses.void(a.tenant, expense.id, 1, { reason: 'Correction' });
    expect((await r.reports.preview(a.tenant, 'PAYMENT_REGISTER', REPORT_RANGE)).data).toEqual([]);
    expect((await r.reports.preview(a.tenant, 'EXPENSE_REGISTER', REPORT_RANGE)).data).toEqual([]);
    expect(
      (await r.reports.preview(a.tenant, 'RECEIVABLES', { asOfDate: '2026-02-01' })).data[1].amount,
    ).toBe('1000.00');
  });
  it('conceals foreign exports/downloads and rejects forged tenant scopes and revoked memberships', async () => {
    const { data } = await request('CASH_FLOW');
    await expect(r.reports.detail(b.tenant, data.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(r.reports.download(b.tenant, data.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    await expect(r.reports.list({ ...a.tenant }, {})).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    const job = await exportJob(prisma, data);
    await r.generation.handleEvent({ ...job, organizationId: b.org.id });
    expect((await row(data.id)).status).toBe('PENDING');
    await prisma.membership.updateMany({
      where: { organizationId: a.org.id },
      data: { status: 'SUSPENDED' },
    });
    await r.generation.handleEvent(job);
    expect(await row(data.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'REPORT_ACCESS_REVOKED',
    });
    await expect(r.reports.detail(a.tenant, data.id)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });
  it('suppresses mismatched event/source identifiers without touching the foreign export', async () => {
    const invoiceEvent = await prisma.pendingEvent.findFirstOrThrow({
      where: { organizationId: a.org.id, eventType: 'INVOICE_ISSUED' },
    });
    await r.generation.handleEvent({
      version: 1,
      organizationId: a.org.id,
      eventId: invoiceEvent.id,
    });
    expect(await prisma.pendingEvent.findUnique({ where: { id: invoiceEvent.id } })).toEqual(
      invoiceEvent,
    );
    const { data } = await request('CASH_FLOW');
    const job = await exportJob(prisma, data);
    await prisma.pendingEvent.update({
      where: { id: job.eventId },
      data: { payload: { version: 1, organizationId: b.org.id, exportId: data.id } },
    });
    await r.generation.handleEvent(job);
    expect((await row(data.id)).status).toBe('PENDING');
    expect(await prisma.pendingEvent.findUnique({ where: { id: job.eventId } })).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'INVALID_REPORT_EVENT',
    });
  });
  it('bounds transient generation attempts, then persists a safe permanent failure', async () => {
    const { data } = await request('CASH_FLOW'),
      job = await exportJob(prisma, data);
    r.storage.write = async () => {
      throw new Error('provider secret /absolute/private/path');
    };
    await expect(r.generation.handleEvent(job)).rejects.toThrow('REPORT_RETRY');
    await expect(r.generation.handleEvent(job)).rejects.toThrow('REPORT_RETRY');
    await r.generation.handleEvent(job);
    await r.generation.handleEvent(job);
    expect(await row(data.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'REPORT_ATTEMPTS_EXHAUSTED',
    });
    expect((await r.reports.detail(a.tenant, data.id)).data.errorCode).not.toContain('secret');
  });
  it('persists permanent definition and size failures without retrying or generating notifications', async () => {
    const invalid = (await request('CASH_FLOW')).data;
    await prisma.reportExport.update({
      where: { id: invalid.id },
      data: { parameters: { path: '../../private' } },
    });
    await r.generation.handleEvent(await exportJob(prisma, invalid));
    expect(await row(invalid.id)).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_REQUEST' });
    const oversized = (await request('INVOICE_REGISTER')).data;
    r.reader.read = async () => Array.from({ length: 10001 }, () => ({ id: randomUUID() }));
    await r.generation.handleEvent(await exportJob(prisma, oversized));
    expect(await row(oversized.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'REPORT_TOO_LARGE',
    });
    expect(await prisma.notification.count({ where: { type: 'REPORT_READY' } })).toBe(0);
  });
  it('recovers a stale RUNNING lease, preserves READY on later execution, and expires metadata without deleting files', async () => {
    const { data } = await request('CASH_FLOW'),
      job = await exportJob(prisma, data);
    await prisma.reportExport.update({
      where: { id: data.id },
      data: {
        status: 'RUNNING',
        updatedAt: new Date(Date.now() - 61000),
        errorCode: 'REPORT_ATTEMPT_1',
      },
    });
    await r.generation.handleEvent(job);
    const ready = await row(data.id);
    expect(ready.status).toBe('READY');
    await prisma.reportExport.update({
      where: { id: data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await r.reports.detail(a.tenant, data.id)).data.status).toBe('EXPIRED');
    expect((await row(data.id)).status).toBe('EXPIRED');
    await expect(r.reports.download(a.tenant, data.id)).rejects.toMatchObject({
      code: 'EXPORT_EXPIRED',
    });
    expect(await r.storage.read(ready.storageObjectKey, ready.checksum, a.org.id)).toBeInstanceOf(
      Buffer,
    );
  });
  it('paginates register, aging, and tied export timestamps with tenant/filter-bound cursors', async () => {
    const page = await r.reports.preview(a.tenant, 'INVOICE_REGISTER', {
      ...REPORT_RANGE,
      limit: '1',
    });
    expect(page.data).toHaveLength(1);
    expect(page.meta.hasMore).toBe(false);
    const aging = await r.reports.preview(a.tenant, 'RECEIVABLES', {
      asOfDate: '2026-02-01',
      limit: '1',
    });
    expect(aging.data[0].bucket).toBe('CURRENT');
    const next = await r.reports.preview(a.tenant, 'RECEIVABLES', {
      asOfDate: '2026-02-01',
      limit: '1',
      after: aging.meta.nextCursor,
    });
    expect(next.data[0].bucket).toBe('1_30');
    for (let i = 0; i < 3; i++) await request('CASH_FLOW');
    await prisma.reportExport.updateMany({
      where: { organizationId: a.org.id },
      data: { createdAt: new Date('2026-01-01') },
    });
    const first = await r.reports.list(a.tenant, { limit: '1' });
    const second = await r.reports.list(a.tenant, { limit: '1', after: first.meta.nextCursor });
    expect(first.data[0].id).not.toBe(second.data[0].id);
    await expect(r.reports.list(b.tenant, { after: first.meta.nextCursor })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
  });
  it('rejects not-ready downloads and path traversal and detects corrupted artifacts', async () => {
    const { data } = await request('CASH_FLOW');
    await expect(r.reports.download(a.tenant, data.id)).rejects.toMatchObject({
      code: 'EXPORT_NOT_READY',
    });
    expect(() => r.storage.path('../secret')).toThrow();
    await r.generation.handleEvent(await exportJob(prisma, data));
    await prisma.reportExport.update({ where: { id: data.id }, data: { checksum: 'corrupt' } });
    await expect(r.reports.download(a.tenant, data.id)).rejects.toMatchObject({
      code: 'EXPORT_ARTIFACT_UNAVAILABLE',
    });
  });
});
