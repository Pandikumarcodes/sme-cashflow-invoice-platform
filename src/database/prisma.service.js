import { Injectable } from '@nestjs/common';

@Injectable()
export class PrismaService {
  client;
  initialization;

  async getClient() {
    if (this.client) {
      return this.client;
    }

    this.initialization ??= import('@prisma/client')
      .then(({ PrismaClient }) => {
        this.client = new PrismaClient();
        return this.client;
      })
      .catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }

  async onModuleDestroy() {
    if (this.initialization) await this.initialization;
    if (this.client) {
      await this.client.$disconnect();
    }
  }

  async isHealthy() {
    const client = await this.getClient();
    await client.$queryRaw`SELECT 1`;
  }
}
