import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  decodeCursor,
  encodeCursor,
  listFilter,
  listOptions,
  listOrder,
} from './expense-pagination.js';

describe('expense and category bound cursors', () => {
  const organizationId = randomUUID();
  it.each(['expenseDate', 'createdAt', 'amount', 'vendorPayee'])(
    'round-trips %s tuples in both directions',
    (sortBy) => {
      for (const sortOrder of ['asc', 'desc']) {
        const options = listOptions(organizationId, { sortBy, sortOrder });
        const row = {
          id: randomUUID(),
          expenseDate: new Date('2026-01-01T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:01.000Z'),
          amount: new Prisma.Decimal('999999999999999.99'),
          vendorPayee: 'Vendor',
        };
        const key = decodeCursor(encodeCursor(row, options), options);
        expect(key.id).toBe(row.id);
        expect(listOrder(options)[1]).toEqual({ id: sortOrder });
        expect(listFilter(options, key).AND.at(-1).OR[1].id).toEqual({
          [sortOrder === 'asc' ? 'gt' : 'lt']: row.id,
        });
      }
    },
  );
  it('puts nullable vendors last for both directions and paginates the null tail', () => {
    for (const sortOrder of ['asc', 'desc']) {
      const options = listOptions(organizationId, { sortBy: 'vendorPayee', sortOrder });
      expect(listOrder(options)[0]).toEqual({ vendorPayee: { sort: sortOrder, nulls: 'last' } });
      const row = { id: randomUUID(), vendorPayee: null };
      const key = decodeCursor(encodeCursor(row, options), options);
      expect(listFilter(options, key).AND.at(-1)).toEqual({
        vendorPayee: null,
        id: { [sortOrder === 'asc' ? 'gt' : 'lt']: row.id },
      });
      expect(listFilter(options, { id: row.id, value: 'Vendor' }).AND.at(-1).OR.at(-1)).toEqual({
        vendorPayee: null,
      });
    }
  });
  it('binds every filter, tenant, resource kind and ordering, retaining limit flexibility', () => {
    const query = {
      categoryId: randomUUID(),
      status: 'ACTIVE',
      expenseDateFrom: '2026-01-01',
      expenseDateTo: '2026-01-31',
      vendor: 'Acme',
      sortBy: 'amount',
      sortOrder: 'asc',
    };
    const options = listOptions(organizationId, query);
    const cursor = encodeCursor({ id: randomUUID(), amount: new Prisma.Decimal('1') }, options);
    for (const [field, value] of Object.entries({
      categoryId: randomUUID(),
      status: 'VOIDED',
      expenseDateFrom: '2026-01-02',
      expenseDateTo: '2026-02-01',
      vendor: 'Other',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }))
      expect(() =>
        decodeCursor(cursor, listOptions(organizationId, { ...query, [field]: value })),
      ).toThrow(expect.objectContaining({ code: 'INVALID_CURSOR' }));
    expect(() => decodeCursor(cursor, listOptions(randomUUID(), query))).toThrow();
    expect(() => decodeCursor(cursor, listOptions(organizationId, {}, true))).toThrow();
    expect(
      decodeCursor(cursor, listOptions(organizationId, { ...query, limit: '100' })),
    ).toBeTruthy();
  });
  it('rejects noncanonical, oversized, malformed and extra-key cursor data', () => {
    const options = listOptions(organizationId, {});
    for (const cursor of [
      '',
      '%%%',
      'a'.repeat(2049),
      Buffer.from('{}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          v: 1,
          signature: options.signature,
          key: { id: randomUUID(), value: '2026-01-01T00:00:00.000Z' },
          extra: true,
        }),
      ).toString('base64url'),
    ])
      expect(() => decodeCursor(cursor, options)).toThrow(
        expect.objectContaining({ code: 'INVALID_CURSOR' }),
      );
  });
  it('uses minimal category ordering and binds archive scope', () => {
    const options = listOptions(organizationId, {}, true);
    const cursor = encodeCursor({ id: randomUUID(), name: 'Rent' }, options);
    expect(listOrder(options)).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(decodeCursor(cursor, options).value).toBe('Rent');
    expect(() =>
      decodeCursor(cursor, listOptions(organizationId, { status: 'ARCHIVED' }, true)),
    ).toThrow();
  });
  it('escapes literal vendor wildcard characters and enforces inclusive range bounds', () => {
    const options = listOptions(organizationId, {
      vendor: 'A%_\\',
      expenseDateFrom: '2026-01-01',
      expenseDateTo: '2026-01-01',
    });
    expect(listFilter(options, null).AND).toContainEqual({
      vendorPayee: { contains: 'A\\%\\_\\\\', mode: 'insensitive' },
    });
    expect(() =>
      listOptions(organizationId, { expenseDateFrom: '2026-01-02', expenseDateTo: '2026-01-01' }),
    ).toThrow();
    expect(() =>
      listOptions(organizationId, { expenseDateFrom: '2020-01-01', expenseDateTo: '2026-01-01' }),
    ).toThrow();
  });
});
