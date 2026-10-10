import { randomUUID } from 'node:crypto';
import { auditOptions, auditCursor, auditFilter, auditDayStart } from './audit-query.js';
import { toAuditResponse } from './audit-response.js';

const org = randomUUID();
const options = (query = {}, timezone = 'Asia/Kolkata') => auditOptions(org, query, timezone);
describe('audit query and public projection', () => {
  it('normalizes only documented filters and rejects unbounded/unknown input', () => {
    expect(options()).toMatchObject({ limit: 25, sortOrder: 'desc', filters: {} });
    const actor = randomUUID(),
      entity = randomUUID();
    expect(
      options({
        actorUserId: actor,
        entityId: entity,
        action: 'report.export.request',
        entityType: 'ReportExport',
      }).filters,
    ).toEqual({
      actorUserId: actor,
      entityId: entity,
      action: 'report.export.request',
      entityType: 'ReportExport',
    });
    for (const query of [
      { limit: '101' },
      { limit: 25 },
      { action: ['X'] },
      { requestId: 'X' },
      { actorUserId: 'no' },
      { sortBy: 'action' },
      { sortOrder: 'bad' },
      { action: '' },
    ])
      expect(() => options(query)).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
  });
  it('uses local calendar days against audit instants with inclusive start/exclusive next day', () => {
    expect(
      options({ occurredFrom: '2026-01-01', occurredTo: '2026-01-01' }).filters.occurredAt,
    ).toEqual({ gte: new Date('2025-12-31T18:30:00Z'), lt: new Date('2026-01-01T18:30:00Z') });
    for (const query of [
      { occurredFrom: '2026-02-30' },
      { occurredFrom: '2026-02-01', occurredTo: '2026-01-01' },
      { occurredFrom: '2020-01-01', occurredTo: '2026-01-01' },
      { occurredTo: '9999-12-31' },
      { occurredFrom: '2026-01-01T00:00:00Z' },
    ])
      expect(() => options(query)).toThrow();
  });
  it('handles DST and a skipped local calendar day without server timezone assumptions', () => {
    expect(auditDayStart('0001-01-01', 'UTC').toISOString()).toBe('0001-01-01T00:00:00.000Z');
    expect(auditDayStart('9999-12-31', 'America/New_York').toISOString()).toBe(
      '9999-12-31T05:00:00.000Z',
    );
    expect(auditDayStart('2026-03-08', 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(auditDayStart('2026-03-09', 'America/New_York').toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
    expect(auditDayStart('2011-12-30', 'Pacific/Apia').toISOString()).toBe(
      '2011-12-30T10:00:00.000Z',
    );
  });
  it('binds cursor positions to tenant, filters and sort while accepting page size changes', () => {
    const row = { id: randomUUID(), occurredAt: new Date('2026-01-01') };
    const cursor = auditCursor(row, options());
    expect(auditFilter(options({ after: cursor, limit: '100' })).AND[1]).toEqual({
      OR: [
        { occurredAt: { lt: row.occurredAt } },
        { occurredAt: row.occurredAt, id: { lt: row.id } },
      ],
    });
    const asc = options({ sortOrder: 'asc' });
    expect(
      auditFilter(options({ sortOrder: 'asc', after: auditCursor(row, asc) })).AND[1].OR[0],
    ).toEqual({ occurredAt: { gt: row.occurredAt } });
    for (const changed of [{ action: 'X' }, { sortOrder: 'asc' }])
      expect(() => auditFilter(options({ after: cursor, ...changed }))).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    expect(() => auditFilter(auditOptions(randomUUID(), { after: cursor }, 'UTC'))).toThrow();
  });
  it('rejects noncanonical, malformed and invalid timestamp/UUID cursors', () => {
    const row = { id: randomUUID(), occurredAt: new Date('2026-01-01') };
    const valid = JSON.parse(Buffer.from(auditCursor(row, options()), 'base64url').toString());
    for (const value of [
      { ...valid, v: 2 },
      { ...valid, extra: true },
      { ...valid, key: { id: 'bad', value: valid.key.value } },
      { ...valid, key: { id: row.id, value: '2026-01-01' } },
    ]) {
      const after = Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(() => auditFilter(options({ after }))).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
    }
    expect(() => auditFilter(options({ after: 'garbage' }))).toThrow();
  });
  it('preserves historical names, nullable actors and safe nested financial strings without leaking credentials', () => {
    const row = {
      id: randomUUID(),
      entityType: 'Payment',
      action: 'PAYMENT_RECORDED',
      actorType: 'SYSTEM',
      actorUserId: null,
      actorMembershipId: null,
      occurredAt: new Date('2026-01-01'),
      actorSessionId: 'private',
      ipAddress: '127.0.0.1',
      userAgent: 'private',
      changedFields: ['payment', 'invoice.balanceDue', 'passwordHash'],
      afterData: {
        payment: { amount: '900719925474099.99', token: 'sensitive-test', status: 'RECORDED' },
        invoice: { balanceDue: '0.01', accessToken: 'sensitive-test' },
        passwordHash: 'sensitive-test',
      },
      metadata: { providerSecret: 'sensitive-test', stack: 'sensitive-test' },
    };
    const original = JSON.stringify(row);
    const result = toAuditResponse(row);
    expect(result).toMatchObject({
      actorUserId: null,
      action: row.action,
      metadata: null,
      changedFields: ['payment', 'invoice.balanceDue'],
      afterData: {
        payment: { amount: '900719925474099.99', status: 'RECORDED' },
        invoice: { balanceDue: '0.01' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|sensitive-test|passwordHash|accessToken/);
    expect(JSON.stringify(row)).toBe(original);
  });
  it('fails closed for unknown entities, oversized values and injected nested objects in scalar fields', () => {
    const row = {
      occurredAt: new Date(),
      entityType: 'Unknown',
      afterData: { password: 'sensitive-test' },
      changedFields: ['password'],
    };
    expect(toAuditResponse(row)).toMatchObject({ afterData: null, changedFields: [] });
    row.entityType = 'Customer';
    row.afterData = { email: { token: 'sensitive-test' }, displayName: 'x'.repeat(2049) };
    expect(toAuditResponse(row).afterData).toEqual({ email: null, displayName: null });
  });
});
