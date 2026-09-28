import { Module } from '@nestjs/common';

import { RequestContextMiddleware } from './common/request-context/request-context.middleware.js';
import { RequestContextModule } from './common/request-context/request-context.module.js';
import { AuthorizationModule } from './common/authorization/authorization.module.js';
import { ConfigurationModule } from './config/configuration.module.js';
import { DatabaseModule } from './database/database.module.js';
import { QueueModule } from './infrastructure/queues/queue.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { MembershipsModule } from './modules/memberships/memberships.module.js';
import { ObservabilityModule } from './observability/observability.module.js';

@Module({
  imports: [
    ConfigurationModule,
    DatabaseModule,
    RedisModule,
    QueueModule,
    AuthorizationModule,
    RequestContextModule,
    ObservabilityModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    HealthModule,
  ],
})
export class AppModule {
  configure(consumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
