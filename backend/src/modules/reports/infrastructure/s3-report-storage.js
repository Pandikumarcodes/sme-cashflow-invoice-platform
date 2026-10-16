import { createHash, randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const MAX_BYTES = 10 * 1024 * 1024;
const OBJECT_TIMEOUT_MS = 10000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ORGANIZATION_KEY = new RegExp(`^${UUID}/${UUID}\\.csv$`);

export class S3ReportStorage {
  constructor(config, client) {
    this.bucket = config.getOrThrow('REPORT_S3_BUCKET');
    this.prefix = config.getOrThrow('REPORT_S3_OBJECT_PREFIX');
    this.client =
      client ??
      new S3Client({
        region: config.getOrThrow('REPORT_S3_REGION'),
        ...(config.get('REPORT_S3_ENDPOINT')
          ? { endpoint: config.get('REPORT_S3_ENDPOINT'), forcePathStyle: true }
          : {}),
        credentials: {
          accessKeyId: config.getOrThrow('REPORT_S3_ACCESS_KEY_ID'),
          secretAccessKey: config.getOrThrow('REPORT_S3_SECRET_ACCESS_KEY'),
        },
        maxAttempts: 2,
      });
  }

  objectKey(key, organizationId) {
    if (!ORGANIZATION_KEY.test(key) || (organizationId && !key.startsWith(`${organizationId}/`)))
      throw new Error('INVALID_ARTIFACT_KEY');
    return `${this.prefix}/${key}`;
  }

  async write(organizationId, bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length > MAX_BYTES ||
      !new RegExp(`^${UUID}$`).test(organizationId)
    )
      throw new Error('ARTIFACT_UNAVAILABLE');
    const key = `${organizationId}/${randomUUID()}.csv`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, organizationId),
        Body: bytes,
        ContentType: 'text/csv; charset=utf-8',
        IfNoneMatch: '*',
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_TIMEOUT_MS) },
    );
    return { key, checksum: createHash('sha256').update(bytes).digest('hex') };
  }

  async read(key, checksum, organizationId) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key, organizationId) }),
      { abortSignal: AbortSignal.timeout(OBJECT_TIMEOUT_MS) },
    );
    if (response.ContentLength > MAX_BYTES || !response.Body)
      throw new Error('ARTIFACT_UNAVAILABLE');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.Body) {
      size += chunk.length;
      if (size > MAX_BYTES) {
        response.Body.destroy?.();
        throw new Error('ARTIFACT_UNAVAILABLE');
      }
      chunks.push(chunk);
    }
    if (response.ContentLength !== undefined && size !== response.ContentLength)
      throw new Error('ARTIFACT_UNAVAILABLE');
    const bytes = Buffer.concat(chunks, size);
    if (createHash('sha256').update(bytes).digest('hex') !== checksum)
      throw new Error('ARTIFACT_UNAVAILABLE');
    return bytes;
  }

  async discard(key, organizationId) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key, organizationId),
      }),
      { abortSignal: AbortSignal.timeout(OBJECT_TIMEOUT_MS) },
    );
  }

  onModuleDestroy() {
    this.client.destroy?.();
  }
}
