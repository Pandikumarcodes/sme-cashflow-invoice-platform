import { registerAs } from '@nestjs/config';
import { parseEnvironment } from './env.schema.js';
export default registerAs('notification', () => {
  const env = parseEnvironment(process.env);
  return {
    enabled: env.REMINDERS_ENABLED,
    daysBeforeDue: env.REMINDERS_DAYS_BEFORE_DUE,
    overdueCadenceDays: env.REMINDERS_OVERDUE_CADENCE_DAYS,
    emailProvider: env.EMAIL_PROVIDER,
    workerConcurrency: env.WORKER_CONCURRENCY,
  };
});
