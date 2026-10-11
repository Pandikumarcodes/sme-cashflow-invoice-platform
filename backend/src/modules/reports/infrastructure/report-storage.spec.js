import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
const file = { stat: jest.fn(), read: jest.fn(), close: jest.fn(async () => {}) };
const open = jest.fn(async () => file);
jest.unstable_mockModule('node:fs/promises', () => ({ open, mkdir: jest.fn(), unlink: jest.fn() }));
const { ReportStorage } = await import('./report-storage.js');
const organizationId = '11111111-1111-4111-8111-111111111111';
const key = organizationId + '/22222222-2222-4222-8222-222222222222.csv';
const storage = new ReportStorage({ get: () => '.private/reports' });
describe('bounded report reads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('rejects oversized files before allocating or reading their contents', async () => {
    file.stat.mockResolvedValue({ isFile: () => true, size: 10 * 1024 * 1024 + 1 });
    await expect(storage.read(key, 'checksum', organizationId)).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    expect(file.read).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledTimes(1);
  });
  it('reads a bounded artifact and verifies its checksum', async () => {
    const bytes = Buffer.from('a,b\n');
    file.stat.mockResolvedValue({ isFile: () => true, size: bytes.length });
    file.read
      .mockImplementationOnce(async (buffer) => {
        bytes.copy(buffer);
        return { bytesRead: bytes.length };
      })
      .mockResolvedValueOnce({ bytesRead: 0 });
    await expect(
      storage.read(key, createHash('sha256').update(bytes).digest('hex'), organizationId),
    ).resolves.toEqual(bytes);
    expect(file.close).toHaveBeenCalledTimes(1);
  });
  it('rejects growth after stat and cross-tenant keys', async () => {
    file.stat.mockResolvedValue({ isFile: () => true, size: 1 });
    file.read.mockResolvedValue({ bytesRead: 2 });
    await expect(storage.read(key, 'checksum', organizationId)).rejects.toThrow(
      'ARTIFACT_UNAVAILABLE',
    );
    open.mockClear();
    await expect(storage.read(key, 'checksum', 'other')).rejects.toThrow('INVALID_ARTIFACT_KEY');
    expect(open).not.toHaveBeenCalled();
  });
});
