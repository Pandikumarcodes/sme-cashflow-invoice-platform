import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('trims and lowercases without provider-specific rewriting', () => {
    expect(normalizeEmail('  First.Last+tag@Example.COM ')).toBe('first.last+tag@example.com');
  });
});
