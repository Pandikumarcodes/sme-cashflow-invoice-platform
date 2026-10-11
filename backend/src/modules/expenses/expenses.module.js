import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrganizationsModule } from '../organizations/organizations.module.js';
import { ExpenseCategoriesController } from './expense-categories.controller.js';
import { ExpensesController } from './expenses.controller.js';
import { ExpenseCategoriesService } from './application/expense-categories.service.js';
import { ExpensesService } from './application/expenses.service.js';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [ExpenseCategoriesController, ExpensesController],
  providers: [ExpenseCategoriesService, ExpensesService],
})
export class ExpensesModule {}
