import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtVerify, SignJWT } from 'jose';

@Injectable()
export class AccessTokenService {
  constructor(configService) {
    this.config = configService.getOrThrow('auth');
    this.privateKey = createPrivateKey({
      key: Buffer.from(this.config.accessPrivateKeyBase64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    this.publicKey = createPublicKey({
      key: Buffer.from(this.config.accessPublicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
  }

  async issue(userId, sessionId) {
    const accessToken = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: this.config.keyId })
      .setSubject(userId)
      .setJti(randomUUID())
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessLifetimeSeconds}s`)
      .sign(this.privateKey);
    return { accessToken, tokenType: 'Bearer', expiresIn: this.config.accessLifetimeSeconds };
  }

  async verify(token) {
    const { payload, protectedHeader } = await jwtVerify(token, this.publicKey, {
      algorithms: ['EdDSA'],
      issuer: this.config.issuer,
      audience: this.config.audience,
      requiredClaims: ['sub', 'sid', 'jti', 'iat', 'exp'],
      clockTolerance: 5,
    });
    if (protectedHeader.kid !== this.config.keyId || typeof payload.sid !== 'string') {
      throw new Error('Invalid access token claims');
    }
    return payload;
  }
}
Inject(ConfigService)(AccessTokenService, undefined, 0);
