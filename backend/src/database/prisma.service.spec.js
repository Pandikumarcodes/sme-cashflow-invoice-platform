import { jest } from '@jest/globals';
const disconnect = jest.fn(async () => {});
const constructor = jest.fn(() => ({ $disconnect: disconnect }));
jest.unstable_mockModule('@prisma/client', () => ({ PrismaClient: constructor }));
const { PrismaService } = await import('./prisma.service.js');
describe('Prisma client ownership', () => {
  beforeEach(() => {
    constructor.mockClear();
    disconnect.mockClear();
  });
  it('shares concurrent initialization and disconnects the owned client', async () => {
    const service = new PrismaService();
    const [first, second] = await Promise.all([service.getClient(), service.getClient()]);
    expect(first).toBe(second);
    expect(constructor).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
  it('awaits in-flight initialization during shutdown', async () => {
    const service = new PrismaService();
    await Promise.all([service.getClient(), service.onModuleDestroy()]);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
