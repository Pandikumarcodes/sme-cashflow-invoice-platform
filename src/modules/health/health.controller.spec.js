import { HealthController } from './health.controller.js';
describe('HealthController', () => {
  const prisma = { async isHealthy() {} };
  const redis = { async isHealthy() {} };
  const controller = new HealthController(prisma, redis);
  it('reports liveness', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });
  it('reports database and Redis readiness', async () => {
    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
  });
  it('returns a safe service-unavailable exception when a dependency is unavailable', async () => {
    redis.isHealthy = async () => {
      throw new Error('private connection detail');
    };
    await expect(controller.ready()).rejects.toMatchObject({ status: 503 });
    redis.isHealthy = async () => {};
  });
});
