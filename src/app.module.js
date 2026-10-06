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
import { CustomersModule } from './modules/customers/customers.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { CashFlowModule } from './modules/cash-flow/cash-flow.module.js';
import { ProfitLossModule } from './modules/profit-loss/profit-loss.module.js';
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
    CustomersModule,
    InvoicesModule,
    PaymentsModule,
    ExpensesModule,
    CashFlowModule,
    ProfitLossModule,
    HealthModule,
  ],
})
export class AppModule {
  configure(consumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
