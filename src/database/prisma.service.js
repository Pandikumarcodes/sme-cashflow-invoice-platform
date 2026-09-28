import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaService {
  client;

  async getClient() {
    if (this.client) {
      return this.client;
    }

    const { PrismaClient } = await import('@prisma/client');
    this.client = new PrismaClient();
    return this.client;
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.$disconnect();
    }
  }

  async isHealthy() {
    const client = await this.getClient();
    await client.$queryRaw`SELECT 1`;
  }
}
