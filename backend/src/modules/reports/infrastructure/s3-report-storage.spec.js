import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { S3ReportStorage } from './s3-report-storage.js';

const organizationId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const config = {
  getOrThrow: (name) =>
    ({
      REPORT_S3_BUCKET: 'private-report-artifacts',
      REPORT_S3_REGION: 'us-east-1',
      REPORT_S3_ACCESS_KEY_ID: 'fake-test-id',
      REPORT_S3_SECRET_ACCESS_KEY: 'fake-test-secret',
      REPORT_S3_OBJECT_PREFIX: 'staging/reports',
    })[name],
  get: () => undefined,
};
const stream = (bytes) =>
  (async function* () {
    yield bytes;
  })();

describe('private S3 report storage', () => {
  const bytes = Buffer.from('a,b\r\n1,2\r\n');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  let objects, client, storage;
  beforeEach(() => {
    objects = new Map();
    client = {
      send: jest.fn(async (command) => {
        const name = command.constructor.name;
        const { Key, Body } = command.input;
        if (name === 'PutObjectCommand') {
          objects.set(Key, Body);
          return {};
        }
        if (name === 'GetObjectCommand') {
          const object = objects.get(Key);
          if (!object) throw new Error('NoSuchKey');
          return { Body: stream(object), ContentLength: object.length };
        }
        if (name === 'DeleteObjectCommand') {
          objects.delete(Key);
          return {};
        }
        throw new Error('Unexpected command');
      }),
    };
    storage = new S3ReportStorage(config, client);
  });
  it('stores privately under a tenant key and downloads from a separate instance', async () => {
    const artifact = await storage.write(organizationId, bytes);
    expect(artifact.checksum).toBe(checksum);
    expect([...objects.keys()]).toEqual([`staging/reports/${artifact.key}`]);
    const apiStorage = new S3ReportStorage(config, client);
    await expect(apiStorage.read(artifact.key, checksum, organizationId)).resolves.toEqual(bytes);
    await expect(apiStorage.read(artifact.key, checksum, otherId)).rejects.toThrow(
      'INVALID_ARTIFACT_KEY',
    );
    expect(client.send).toHaveBeenCalledTimes(2);
    await expect(storage.discard(artifact.key, otherId)).rejects.toThrow('INVALID_ARTIFACT_KEY');
    expect(client.send).toHaveBeenCalledTimes(2);
    await storage.discard(artifact.key, organizationId);
    expect(objects.size).toBe(0);
    await expect(apiStorage.read(artifact.key, checksum, organizationId)).rejects.toThrow(
      'NoSuchKey',
    );
  });
  it('does not report a successful write when upload fails and rejects oversized input', async () => {
    client.send.mockRejectedValueOnce(new Error('storage timeout'));
    await expect(storage.write(organizationId, bytes)).rejects.toThrow('storage timeout');
    expect(objects.size).toBe(0);
    await expect(storage.write(organizationId, Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
  });
  it('rejects truncated, oversized, changed and traversal objects', async () => {
    const artifact = await storage.write(organizationId, bytes);
    objects.set(`staging/reports/${artifact.key}`, Buffer.from('changed'));
    await expect(storage.read(artifact.key, checksum, organizationId)).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    client.send.mockResolvedValueOnce({ Body: stream(bytes), ContentLength: bytes.length + 1 });
    await expect(storage.read(artifact.key, checksum, organizationId)).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    client.send.mockResolvedValueOnce({ ContentLength: 10 * 1024 * 1024 + 1 });
    await expect(storage.read(artifact.key, checksum, organizationId)).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    await expect(storage.read('../other.csv', checksum, organizationId)).rejects.toThrow(
      'INVALID_ARTIFACT_KEY',
    );
    await expect(storage.discard('../other.csv', organizationId)).rejects.toThrow(
      'INVALID_ARTIFACT_KEY',
    );
  });
});
