import { OrganizationsService } from './organizations.service.js';

describe('OrganizationsService input mapping', () => {
  const service = new OrganizationsService({});

  it('defaults display name and preserves only approved creation fields', () => {
    expect(
      service.normalizeCreate({
        legalName: ' Acme Legal ',
        baseCurrency: ' inr ',
        timezone: ' Asia/Kolkata ',
        ownerUserId: 'attacker',
        status: 'CLOSED',
      }),
    ).toEqual({
      legalName: 'Acme Legal',
      displayName: 'Acme Legal',
      baseCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    });
  });

  it('normalizes only approved mutable update fields', () => {
    expect(
      service.normalizeUpdate({
        displayName: ' Updated ',
        invoicePrefix: ' bill- ',
        baseCurrency: ' usd ',
        status: 'CLOSED',
        createdAt: '2026-01-01',
        ownerUserId: 'attacker',
      }),
    ).toEqual({ displayName: 'Updated', baseCurrency: 'USD', invoicePrefix: 'BILL-' });
  });
});
