import argon2 from 'argon2';
import { Injectable } from '@nestjs/common';

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
});

@Injectable()
export class PasswordHasher {
  dummyHashPromise = argon2.hash('not-a-real-user-password', ARGON2_OPTIONS);

  hash(password) {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  verify(hash, password) {
    return argon2.verify(hash, password);
  }

  async verifyDummy(password) {
    const dummyHash = await this.dummyHashPromise;
    await argon2.verify(dummyHash, password);
  }

  needsRehash(hash) {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
