import 'reflect-metadata';
import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { ReportGenerationService } from '../src/modules/reports/application/report-generation.service.js';
import { ReportStorage } from '../src/modules/reports/infrastructure/report-storage.js';
import { clearDatabase, createTestPrismaClient } from './integration/database-test-helpers.js';
import { command, exportJob, reportFixture } from './helpers/report-fixture.js';

jest.setTimeout(30000);
describe('Reports HTTP authorization and CSV download', () => {
  const prisma = createTestPrismaClient();
  let app, server, token, userId, org, base, artifacts;
  const headers = () => ({ Authorization: `Bearer ${token}` });
  const post = (body = command('CASH_FLOW')) =>
    request(server)
      .post(base + '/reports/exports')
      .set(headers())
      .send(body);
  const get = (path, query = {}) =>
    request(server)
      .get(base + path)
      .set(headers())
      .query(query);
  beforeAll(async () => {
    artifacts = reportFixture({ provider: { getClient: async () => prisma }, authorization: {} });
    app = (
      await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ReportStorage)
        .useValue(artifacts.storage)
        .compile()
    ).createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });
  beforeEach(async () => {
    await clearDatabase(prisma);
    const email = 'report-http@example.com',
      password = 'correct horse battery staple';
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Report', lastName: 'User' })
      .expect(201);
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    token = login.body.data.accessToken;
    userId = login.body.data.user.id;
    org = (
      await request(server)
        .post('/api/v1/organizations')
        .set(headers())
        .send({ legalName: 'Report HTTP', baseCurrency: 'INR', timezone: 'Asia/Kolkata' })
        .expect(201)
    ).body.data;
    base = `/api/v1/organizations/${org.id}`;
  });
  afterAll(async () => {
    await app?.close();
    await artifacts?.cleanup();
    await prisma.$disconnect();
  });
  it('returns 202 durable metadata, JSON previews/status/list, and an audited CSV download with safe headers', async () => {
    for (const name of ['invoices', 'payments', 'expenses', 'receivables']) {
      const preview = await get('/reports/' + name).expect(200);
      expect(preview.body.data).toBeInstanceOf(Array);
      expect(preview.body.meta).toHaveProperty('nextCursor');
    }
    const created = (await post().expect(202)).body.data;
    expect(created.status).toBe('PENDING');
    expect(created).not.toHaveProperty('storageObjectKey');
    await get(`/report-exports/${created.id}/download`).expect(409);
    await app.get(ReportGenerationService).handleEvent(await exportJob(prisma, created));
    const detail = (await get(`/report-exports/${created.id}`).expect(200)).body.data;
    expect(detail.status).toBe('READY');
    expect(typeof detail.rowCount).toBe('string');
    const csv = await get(`/report-exports/${created.id}/download`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toBe(
      `attachment; filename="cash_flow-${created.id}.csv"`,
    );
    expect(csv.text).toContain('0.00');
    expect((await get('/report-exports').expect(200)).body.data).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'report.export.download' } })).toBe(1);
  });
  it('supports recommended keys with replay headers and rejects changed requests', async () => {
    const key = randomUUID();
    const first = await post().set('Idempotency-Key', key).expect(202);
    const replay = await post().set('Idempotency-Key', key).expect(202);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    await post(command('CASH_BASIS_PERFORMANCE')).set('Idempotency-Key', key).expect(409);
  });
  it('rejects unknown fields, unapproved types/formats, date/range/cursor errors, and unauthenticated calls', async () => {
    for (const body of [
      { ...command(), organizationId: org.id },
      { ...command(), format: 'PDF' },
      { ...command(), reportType: 'PROFIT_LOSS' },
      command('CASH_FLOW', { fromDate: '2026-02-30' }),
      command('CASH_FLOW', { fromDate: '2024-01-01', toDate: '2025-01-01' }),
      command('CASH_FLOW', { path: '../../secret' }),
    ])
      await post(body).expect(400);
    await get('/reports/invoices', { unsafe: true }).expect(400);
    await get('/report-exports', { limit: '101' }).expect(400);
    await get('/report-exports', { after: 'e30' }).expect(400);
    await request(server)
      .post(base + '/reports/exports')
      .send(command())
      .expect(401);
  });
  it('rechecks role, current membership, tenant and user state on export/download', async () => {
    const created = (await post().expect(202)).body.data;
    await app.get(ReportGenerationService).handleEvent(await exportJob(prisma, created));
    await prisma.membership.updateMany({
      where: { organizationId: org.id },
      data: { role: 'MEMBER' },
    });
    await post().expect(403);
    await get(`/report-exports/${created.id}/download`).expect(403);
    await prisma.membership.updateMany({
      where: { organizationId: org.id },
      data: { role: 'VIEWER' },
    });
    await get(`/report-exports/${created.id}/download`).expect(200);
    const other = (
      await request(server)
        .post('/api/v1/organizations')
        .set(headers())
        .send({
          legalName: 'Other report organization',
          baseCurrency: 'INR',
          timezone: 'Asia/Kolkata',
        })
        .expect(201)
    ).body.data;
    await request(server)
      .get(`/api/v1/organizations/${other.id}/report-exports/${created.id}/download`)
      .set(headers())
      .expect(404);
    await prisma.membership.updateMany({
      where: { organizationId: org.id },
      data: { status: 'SUSPENDED' },
    });
    await get(`/report-exports/${created.id}/download`).expect(404);
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    await get('/report-exports').expect(401);
  });
  it('returns 410 for expired output and retains its durable metadata', async () => {
    const created = (await post().expect(202)).body.data;
    await app.get(ReportGenerationService).handleEvent(await exportJob(prisma, created));
    await prisma.reportExport.update({
      where: { id: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await get(`/report-exports/${created.id}/download`).expect(410);
    expect(expired.body.error.code).toBe('EXPORT_EXPIRED');
    expect((await get(`/report-exports/${created.id}`).expect(200)).body.data.status).toBe(
      'EXPIRED',
    );
  });
});
