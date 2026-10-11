import { randomUUID } from 'node:crypto';
import {
  reportOptions,
  parse,
  REQUEST_SCHEMA,
  LIST_SCHEMA,
  cursorScope,
  encodeCursor,
  decodeCursor,
  exportResponse,
} from './report.js';
const org = { timezone: 'Asia/Kolkata', baseCurrency: 'INR' };
describe('report contracts and cursor isolation', () => {
  it.each([
    'INVOICE_REGISTER',
    'PAYMENT_REGISTER',
    'EXPENSE_REGISTER',
    'CASH_FLOW',
    'CASH_BASIS_PERFORMANCE',
  ])('accepts the inclusive leap-year boundary for %s', (type) => {
    expect(
      reportOptions(
        type,
        {
          fromDate: '2024-01-01',
          toDate: '2024-12-31',
          ...(type === 'INVOICE_REGISTER' ? { asOfDate: '2024-12-31' } : {}),
        },
        org,
      ),
    ).toMatchObject({ fromDate: '2024-01-01', toDate: '2024-12-31' });
  });
  it.each([
    { fromDate: '2024-01-01', toDate: '2025-01-01' },
    { fromDate: '2026-02-30' },
    { fromDate: '2026-02-01', toDate: '2026-01-01' },
    { organizationId: randomUUID() },
    { groupBy: 'hour' },
  ])('rejects unsafe parameters %j', (input) =>
    expect(() => reportOptions('CASH_FLOW', input, org)).toThrow(),
  );
  it.each(['PDF', 'XLSX', 'csv'])('rejects unapproved format %s', (format) =>
    expect(() =>
      parse(REQUEST_SCHEMA, { reportType: 'CASH_FLOW', format, parameters: {} }),
    ).toThrow(),
  );
  it('rejects example-only report types and unknown request/list fields', () => {
    expect(() =>
      parse(REQUEST_SCHEMA, { reportType: 'PROFIT_LOSS', format: 'CSV', parameters: {} }),
    ).toThrow();
    expect(() => parse(LIST_SCHEMA, { createdFrom: '2026-01-01' })).toThrow();
    expect(() => reportOptions('RECEIVABLES', { fromDate: '2026-01-01' }, org)).toThrow();
  });
  it('binds cursors to tenant, report and normalized filters', () => {
    const signature = cursorScope(randomUUID(), 'INVOICE_REGISTER', { status: 'ISSUED' });
    const cursor = encodeCursor({ id: randomUUID() }, signature);
    expect(decodeCursor(cursor, signature)).toMatchObject({ signature });
    expect(() => decodeCursor(cursor, cursorScope(randomUUID(), 'INVOICE_REGISTER', {}))).toThrow();
    expect(() => decodeCursor(cursor + '=', signature)).toThrow();
    expect(() => decodeCursor('e30', signature)).toThrow();
  });
  it('keeps large counts as strings and hides artifact keys and internal retry markers', () => {
    const response = exportResponse({
      id: randomUUID(),
      status: 'RUNNING',
      errorCode: 'REPORT_ATTEMPT_2',
      storageObjectKey: 'secret',
      checksum: 'secret',
      requestedByUserId: randomUUID(),
      rowCount: 9007199254740993n,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(response.rowCount).toBe('9007199254740993');
    expect(response.errorCode).toBeNull();
    expect(response).not.toHaveProperty('storageObjectKey');
    expect(response).not.toHaveProperty('requestedByUserId');
  });
});
