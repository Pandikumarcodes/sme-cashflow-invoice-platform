import { expect, it } from 'vitest';
import { auditFilterError, defaultFilters, parseAuditPage, safeAuditData } from './contracts';
import { auditDestination } from './presentation';
import { auditFixture, orgId, exportId, page } from '../reports/test-fixtures';
it('allows unbounded and one-sided dates without inventing a default range', () => {
  expect(auditFilterError(defaultFilters)).toBeUndefined();
  expect(auditFilterError({ ...defaultFilters, occurredFrom: '2020-01-01' })).toBeUndefined();
  expect(auditFilterError({ ...defaultFilters, occurredTo: '2026-10-12' })).toBeUndefined();
});
it('validates 1825 inclusive days, order, real dates, upper bound and UUIDs', () => {
  expect(
    auditFilterError({ ...defaultFilters, occurredFrom: '2021-01-01', occurredTo: '2025-12-30' }),
  ).toBeUndefined();
  expect(
    auditFilterError({ ...defaultFilters, occurredFrom: '2021-01-01', occurredTo: '2025-12-31' }),
  ).toBeDefined();
  expect(auditFilterError({ ...defaultFilters, occurredFrom: '2026-02-30' })).toBeDefined();
  expect(
    auditFilterError({ ...defaultFilters, occurredFrom: '2026-10-12', occurredTo: '2026-01-01' }),
  ).toBeDefined();
  expect(auditFilterError({ ...defaultFilters, occurredTo: '9999-12-31' })).toBeDefined();
  expect(auditFilterError({ ...defaultFilters, actorUserId: 'bad' })).toBeDefined();
});
it('omits secrets, contacts, nested objects, long values and unknown entity payloads', () => {
  expect(
    safeAuditData(
      {
        status: 'ISSUED',
        total: '10.01',
        token: 'fake-secret',
        email: 'private@example.test',
        items: [{ description: 'private' }],
        version: { secret: true },
        invoiceNumber: 'x'.repeat(2049),
      },
      'Invoice',
    ),
  ).toEqual({ status: 'ISSUED', total: '10.01' });
  expect(safeAuditData({ status: 'ACTIVE' }, 'Unknown')).toBeNull();
  expect(safeAuditData({ status: 'ACTIVE' }, '__proto__')).toBeNull();
});
it('keeps unknown actions while sanitizing snapshots, changed fields and arbitrary metadata', () => {
  const row = parseAuditPage(
    page([
      auditFixture({
        action: 'future.action',
        changedFields: ['status', 'token'],
        afterData: { status: 'ISSUED', token: 'private' },
        metadata: { password: 'private' },
      }),
    ]),
    orgId,
    defaultFilters,
  ).data[0]!;
  expect(row.action).toBe('future.action');
  expect(row.changedFields).toEqual(['status']);
  expect(row.afterData).toEqual({ status: 'ISSUED' });
  expect(row.metadata).toBeNull();
});
it('rejects cross-tenant responses and mismatched filters', () => {
  expect(() => parseAuditPage(page([auditFixture()]), exportId, defaultFilters)).toThrow();
  expect(() =>
    parseAuditPage(page([auditFixture()]), orgId, { ...defaultFilters, action: 'other.action' }),
  ).toThrow();
});
it('creates links only from structured IDs, current scope and permission', () => {
  const row = parseAuditPage(page([auditFixture()]), orgId, defaultFilters).data[0]!;
  expect(auditDestination(row, orgId, (p) => p === 'invoice.read')).toBe(
    `/organizations/${orgId}/invoices/${exportId}`,
  );
  expect(auditDestination(row, orgId, () => false)).toBeNull();
  expect(auditDestination(row, exportId, () => true)).toBeNull();
  expect(auditDestination({ ...row, entityType: 'Unknown' }, orgId, () => true)).toBeNull();
  expect(auditDestination({ ...row, entityType: 'ReportExport' }, orgId, () => true)).toBe(
    `/organizations/${orgId}/reports?exportId=${exportId}`,
  );
});
