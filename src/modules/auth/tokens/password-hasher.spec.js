import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with Argon2id and verifies only the original password', async () => {
    const hash = await hasher.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, 'correct horse battery staple')).resolves.toBe(true);
    await expect(hasher.verify(hash, 'incorrect password')).resolves.toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
  });
});
