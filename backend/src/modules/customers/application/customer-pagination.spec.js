import {
  customerListOptions,
  decodeCustomerCursor,
  encodeCustomerCursor,
} from './customer-pagination.js';

const customer = {
  id: '10000000-0000-4000-8000-000000000001',
  displayName: 'Acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
};

describe('customer pagination cursor validation', () => {
  const options = customerListOptions('tenant-a', {});

  it('round-trips name and timestamp sort positions without depending on a live anchor row', () => {
    for (const sortBy of ['displayName', 'createdAt', 'updatedAt']) {
      const sort = customerListOptions('tenant-a', { sortBy });
      expect(decodeCustomerCursor(encodeCustomerCursor(customer, sort), sort)).toEqual({
        id: customer.id,
        value: sortBy === 'displayName' ? customer.displayName : customer[sortBy].toISOString(),
      });
    }
    expect(decodeCustomerCursor(undefined, options)).toBeNull();
  });

  it('binds cursor scope to tenant, status, search, and sort but permits page-size changes', () => {
    const cursor = encodeCustomerCursor(customer, options);
    for (const changed of [
      customerListOptions('tenant-b', {}),
      customerListOptions('tenant-a', { status: 'ARCHIVED' }),
      customerListOptions('tenant-a', { search: 'Acme' }),
      customerListOptions('tenant-a', { sortBy: 'createdAt' }),
      customerListOptions('tenant-a', { sortOrder: 'desc' }),
    ]) {
      expect(() => decodeCustomerCursor(cursor, changed)).toThrow('Cursor is invalid');
    }
    expect(decodeCustomerCursor(cursor, customerListOptions('tenant-a', { limit: '1' })).id).toBe(
      customer.id,
    );
  });

  it('rejects malformed, noncanonical, oversized, and unknown-version cursor payloads', () => {
    const valid = encodeCustomerCursor(customer, options);
    for (const bad of [
      '',
      null,
      [],
      '%',
      'a'.repeat(2049),
      valid + '=',
      'e30',
      Buffer.from(
        JSON.stringify({
          v: 2,
          signature: options.signature,
          key: { id: customer.id, value: 'Acme' },
        }),
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          v: 1,
          signature: options.signature,
          key: { id: 'not-a-uuid', value: 'Acme' },
        }),
      ).toString('base64url'),
    ]) {
      expect(() => decodeCustomerCursor(bad, options)).toThrow('Cursor is invalid');
    }
  });

  it('rejects invalid dates, extra keys, and invalid name tuple values', () => {
    for (const key of [
      { id: customer.id, value: '' },
      { id: customer.id, value: 'x'.repeat(201) },
      { id: customer.id, value: {} },
      { id: customer.id, value: 'Acme', organizationId: 'tenant-b' },
    ]) {
      const encoded = Buffer.from(
        JSON.stringify({ v: 1, signature: options.signature, key }),
      ).toString('base64url');
      expect(() => decodeCustomerCursor(encoded, options)).toThrow('Cursor is invalid');
    }
    const timeOptions = customerListOptions('tenant-a', { sortBy: 'createdAt' });
    for (const value of ['2026-02-30T00:00:00.000Z', '2026-01-01', 'invalid']) {
      const encoded = Buffer.from(
        JSON.stringify({ v: 1, signature: timeOptions.signature, key: { id: customer.id, value } }),
      ).toString('base64url');
      expect(() => decodeCustomerCursor(encoded, timeOptions)).toThrow('Cursor is invalid');
    }
  });
});
