import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3ReportStorage } from './s3-report-storage.js';

@Injectable()
export class ReportStorage {
  constructor(config, client) {
    this.root = resolve(config.get('REPORT_STORAGE_DIRECTORY') ?? '.private/reports');
    this.remote =
      config.get('REPORT_STORAGE_PROVIDER') === 's3' ? new S3ReportStorage(config, client) : null;
  }
  path(key) {
    if (!/^[0-9a-f-]{36}\/\b[0-9a-f-]{36}\.csv$/.test(key)) throw new Error('INVALID_ARTIFACT_KEY');
    return resolve(this.root, key);
  }
  async write(organizationId, bytes) {
    if (this.remote) return this.remote.write(organizationId, bytes);
    const key = `${organizationId}/${randomUUID()}.csv`;
    const path = this.path(key);
    await mkdir(resolve(this.root, organizationId), { recursive: true, mode: 0o700 });
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    return { key, checksum: createHash('sha256').update(bytes).digest('hex') };
  }
  async read(key, checksum, organizationId) {
    if (this.remote) return this.remote.read(key, checksum, organizationId);
    if (!key.startsWith(organizationId + '/')) throw new Error('INVALID_ARTIFACT_KEY');
    const file = await open(this.path(key), constants.O_RDONLY);
    let bytes;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024) throw new Error('ARTIFACT_UNAVAILABLE');
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size) throw new Error('ARTIFACT_UNAVAILABLE');
      bytes = buffer.subarray(0, length);
    } finally {
      await file.close();
    }
    if (
      bytes.length > 10 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== checksum
    )
      throw new Error('ARTIFACT_UNAVAILABLE');
    return bytes;
  }
  async discard(key, organizationId) {
    if (!key.startsWith(`${organizationId}/`)) throw new Error('INVALID_ARTIFACT_KEY');
    if (this.remote) return this.remote.discard(key, organizationId);
    await unlink(this.path(key));
  }
  onModuleDestroy() {
    this.remote?.onModuleDestroy();
  }
}
Inject(ConfigService)(ReportStorage, undefined, 0);
