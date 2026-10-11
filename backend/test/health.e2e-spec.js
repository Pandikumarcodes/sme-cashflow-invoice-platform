import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { RedisHealthIndicator } from '../src/infrastructure/redis/redis-health.indicator.js';
describe('health endpoints (e2e)', () => {
  let app;
  let server;
  const prisma = { async isHealthy() {}, async $disconnect() {} };
  const redis = { async isHealthy() {} };
  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisHealthIndicator)
      .useValue(redis)
      .compile();
    const nestApp = testingModule.createNestApplication();
    configureApplication(nestApp);
    await nestApp.init();
    app = nestApp;
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });
  it('reports liveness and generates a request ID', async () => {
    const response = await request(server).get('/api/v1/health/live').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('reports application-level readiness', async () => {
    await request(server).get('/api/v1/health/ready').expect(200, { status: 'ok' });
  });
  it('keeps liveness independent and returns a safe not-ready response when PostgreSQL fails', async () => {
    prisma.isHealthy = async () => {
      throw new Error('simulated database outage');
    };
    await request(server).get('/api/v1/health/live').expect(200, { status: 'ok' });
    const response = await request(server).get('/api/v1/health/ready').expect(503);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: response.headers['x-request-id'],
    });
    prisma.isHealthy = async () => {};
  });
  it('keeps liveness independent and returns a safe not-ready response when Redis fails', async () => {
    redis.isHealthy = async () => {
      throw new Error('simulated Redis outage');
    };
    await request(server).get('/api/v1/health/live').expect(200, { status: 'ok' });
    const response = await request(server).get('/api/v1/health/ready').expect(503);
    expect(response.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId: response.headers['x-request-id'],
    });
    redis.isHealthy = async () => {};
  });
  it('propagates a valid incoming request ID', async () => {
    const requestId = 'bd6ffb3e-9f3d-441c-84d9-50f689ab8176';
    const response = await request(server)
      .get('/api/v1/health/live')
      .set('X-Request-Id', requestId)
      .expect(200);
    expect(response.headers['x-request-id']).toBe(requestId);
  });
  it('normalizes framework errors to the public error contract', async () => {
    const response = await request(server).get('/api/v1/missing').expect(404);
    expect(response.body).toEqual({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found.',
        requestId: response.headers['x-request-id'],
      },
    });
  });
});
