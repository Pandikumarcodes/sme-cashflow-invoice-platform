import { expect, it } from 'vitest';
import {
  defaultExportFilters,
  parameterError,
  parseExport,
  parseExports,
  parsePreview,
  reportTypes,
  defaultParameters,
} from './contracts';
import { exportFixture, exportId, orgId, page, instant } from './test-fixtures';
it.each(reportTypes)('accepts explicit normalized parameters for %s', (type) => {
  expect(parameterError(type, defaultParameters(type, 'UTC'))).toBeUndefined();
  expect(
    parameterError(type, { ...defaultParameters(type, 'UTC'), unknown: 'unsafe' }),
  ).toBeDefined();
});
it.each(['2026-02-30', '2026-13-01', 'not-a-date'])(
  'rejects invalid calendar date %s',
  (asOfDate) => {
    expect(parameterError('RECEIVABLES', { asOfDate })).toBeDefined();
  },
);
it('accepts 366 inclusive days and rejects longer, inverted and invalid as-of ranges', () => {
  expect(
    parameterError('CASH_FLOW', { fromDate: '2024-01-01', toDate: '2024-12-31', groupBy: 'day' }),
  ).toBeUndefined();
  expect(
    parameterError('CASH_FLOW', { fromDate: '2024-01-01', toDate: '2025-01-01' }),
  ).toBeDefined();
  expect(
    parameterError('PAYMENT_REGISTER', { fromDate: '2026-02-02', toDate: '2026-02-01' }),
  ).toBeDefined();
  expect(
    parameterError('INVOICE_REGISTER', {
      fromDate: '2026-02-01',
      toDate: '2026-02-28',
      asOfDate: '2026-01-31',
    }),
  ).toBeDefined();
});
it('rejects unsupported type-specific parameters and identifiers', () => {
  expect(
    parameterError('RECEIVABLES', { asOfDate: '2026-10-12', fromDate: '2026-01-01' }),
  ).toBeDefined();
  expect(
    parameterError('PAYMENT_REGISTER', {
      fromDate: '2026-10-01',
      toDate: '2026-10-12',
      invoiceId: 'bad',
    }),
  ).toBeDefined();
  expect(
    parameterError('CASH_BASIS_PERFORMANCE', {
      fromDate: '2026-10-01',
      toDate: '2026-10-12',
      groupBy: 'day',
    }),
  ).toBeDefined();
});
it.each(['PENDING', 'RUNNING', 'FAILED', 'READY', 'EXPIRED'] as const)(
  'verifies %s metadata without fabricating state',
  (status) => {
    const row = exportFixture({
      status,
      ...(['READY', 'EXPIRED'].includes(status)
        ? { rowCount: '9007199254740993', completedAt: instant, expiresAt: instant }
        : {}),
      ...(status === 'FAILED' ? { errorCode: 'REPORT_TOO_LARGE' } : {}),
    });
    expect(
      parseExport(
        { data: { ...row, storageKey: 'private', requestedByUserId: orgId } },
        orgId,
        exportId,
      ),
    ).toEqual(row);
  },
);
it('rejects forged scope, wrong ID, invalid status fields and numeric row counts', () => {
  expect(() => parseExport({ data: exportFixture() }, exportId)).toThrow();
  expect(() => parseExport({ data: exportFixture() }, orgId, orgId)).toThrow();
  expect(() => parseExport({ data: exportFixture({ status: 'READY' }) }, orgId)).toThrow();
  expect(() => parseExport({ data: exportFixture({ errorCode: 'INTERNAL' }) }, orgId)).toThrow();
  expect(() => parseExport({ data: { ...exportFixture(), rowCount: 1 } }, orgId)).toThrow();
});
it('checks filter, duplicate, limit and cursor contracts', () => {
  expect(parseExports(page([exportFixture()]), orgId, defaultExportFilters).data).toHaveLength(1);
  expect(() =>
    parseExports(page([exportFixture(), exportFixture()]), orgId, defaultExportFilters),
  ).toThrow();
  expect(() =>
    parseExports(page([exportFixture()]), orgId, { ...defaultExportFilters, status: 'READY' }),
  ).toThrow();
  expect(() => parseExports(page([], 50), orgId, defaultExportFilters)).toThrow();
  expect(() =>
    parseExports(
      { ...page([]), meta: { limit: 25, hasMore: true, nextCursor: null } },
      orgId,
      defaultExportFilters,
    ),
  ).toThrow();
});
it('preserves precise preview decimals and rejects currency, metadata and minor-unit mismatches', () => {
  const parameters = { asOfDate: '2026-10-12' };
  const body = {
    data: [
      {
        bucket: 'CURRENT',
        invoiceCount: 2,
        amount: '9007199254740993.01',
        currency: 'USD',
        ...parameters,
      },
    ],
    meta: {
      ...page([]).meta,
      ...parameters,
      currency: 'USD',
      timezone: 'UTC',
      basis: 'CURRENT_STATE',
    },
  };
  expect(parsePreview(body, 'RECEIVABLES', parameters, 'USD', 'UTC', 25).data[0]).toMatchObject({
    amount: '9007199254740993.01',
  });
  expect(() => parsePreview(body, 'RECEIVABLES', parameters, 'EUR', 'UTC', 25)).toThrow();
  expect(() =>
    parsePreview(body, 'RECEIVABLES', { asOfDate: '2026-10-13' }, 'USD', 'UTC', 25),
  ).toThrow();
  expect(() =>
    parsePreview(
      { ...body, data: [{ ...body.data[0], amount: '0.001' }] },
      'RECEIVABLES',
      parameters,
      'USD',
      'UTC',
      25,
    ),
  ).toThrow();
});
