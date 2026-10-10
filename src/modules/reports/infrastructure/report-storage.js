import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ReportStorage {
  constructor(config) {
    this.root = resolve(config.get('REPORT_STORAGE_DIRECTORY') ?? '.private/reports');
  }
  path(key) {
    if (!/^[0-9a-f-]{36}\/\b[0-9a-f-]{36}\.csv$/.test(key)) throw new Error('INVALID_ARTIFACT_KEY');
    return resolve(this.root, key);
  }
  async write(organizationId, bytes) {
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
    if (!key.startsWith(organizationId + '/')) throw new Error('INVALID_ARTIFACT_KEY');
    const bytes = await readFile(this.path(key));
    if (
      bytes.length > 10 * 1024 * 1024 ||
      createHash('sha256').update(bytes).digest('hex') !== checksum
    )
      throw new Error('ARTIFACT_UNAVAILABLE');
    return bytes;
  }
  async discard(key) {
    await unlink(this.path(key));
  }
}
Inject(ConfigService)(ReportStorage, undefined, 0);
