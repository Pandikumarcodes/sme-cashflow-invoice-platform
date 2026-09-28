import { AccessTokenService } from './access-token.service.js';

const config = {
  accessPrivateKeyBase64: 'MC4CAQAwBQYDK2VwBCIEIDdyP69H0Zo0OMz9ELCqVFpF9wwAIH2Fm6GGNtW6YRX8',
  accessPublicKeyBase64: 'MCowBQYDK2VwAyEABdqDMyeA8N8yOW/It/UtBCMURg8cJkEWDd0PiBwYeUw=',
  accessLifetimeSeconds: 900,
  issuer: 'issuer',
  audience: 'audience',
  keyId: 'key-1',
};

describe('AccessTokenService', () => {
  const service = new AccessTokenService({ getOrThrow: () => config });

  it('issues and strictly verifies minimal access claims', async () => {
    const result = await service.issue(
      'f39ebc9c-7667-454a-a44e-17969ac46658',
      '883ab3a6-45dd-48f0-8e8a-26837dc5694c',
    );
    const claims = await service.verify(result.accessToken);
    expect(claims).toEqual(
      expect.objectContaining({
        sub: 'f39ebc9c-7667-454a-a44e-17969ac46658',
        sid: '883ab3a6-45dd-48f0-8e8a-26837dc5694c',
        iss: 'issuer',
        aud: 'audience',
      }),
    );
    expect(claims).not.toHaveProperty('email');
    expect(claims).not.toHaveProperty('permissions');
  });
});
