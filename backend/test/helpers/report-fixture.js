import { randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { rm } from 'node:fs/promises';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service.js';
import { CashFlowReader } from '../../src/modules/financial/infrastructure/cash-flow-reader.js';
import { ProfitLossReader } from '../../src/modules/financial/infrastructure/profit-loss-reader.js';
import { AnalyticsReader } from '../../src/modules/financial/infrastructure/analytics-reader.js';
import { ReportReader } from '../../src/modules/financial/infrastructure/report-reader.js';
import { ReportsService } from '../../src/modules/reports/application/reports.service.js';
import { ReportGenerationService } from '../../src/modules/reports/application/report-generation.service.js';
import { ReportPersistence } from '../../src/modules/reports/infrastructure/report-persistence.js';
import { ReportStorage } from '../../src/modules/reports/infrastructure/report-storage.js';
import { ReportReadyNotifier } from '../../src/modules/notifications/application/report-ready-notifier.js';

export const REPORT_RANGE = { fromDate: '2026-01-01', toDate: '2026-01-31' };
export const command = (type = 'INVOICE_REGISTER', parameters = REPORT_RANGE) => ({
  reportType: type,
  format: 'CSV',
  parameters: type === 'RECEIVABLES' ? { asOfDate: '2026-02-01' } : parameters,
});
export function reportFixture(fixture) {
  const base = resolve('.private/report-tests');
  const directory = resolve(base, randomUUID());
  const config = { get: (key) => (key === 'REPORT_STORAGE_DIRECTORY' ? directory : 24) };
  const storage = new ReportStorage(config);
  const cash = new CashFlowReader(),
    performance = new ProfitLossReader(cash),
    analytics = new AnalyticsReader(cash);
  const reader = new ReportReader(cash, performance, analytics),
    exports = new ReportPersistence();
  return {
    reader,
    storage,
    config,
    reports: new ReportsService(
      fixture.provider,
      fixture.authorization,
      reader,
      storage,
      exports,
      new IdempotencyService(),
    ),
    generation: new ReportGenerationService(
      fixture.provider,
      fixture.authorization,
      reader,
      storage,
      exports,
      new ReportReadyNotifier(),
      config,
    ),
    cleanup: async () => {
      if (!directory.startsWith(base + sep)) throw new Error('Unsafe test artifact directory.');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export async function exportJob(prisma, row) {
  const event = await prisma.pendingEvent.findFirstOrThrow({
    where: {
      organizationId: row.organizationId,
      eventType: 'REPORT_EXPORT_REQUESTED',
      aggregateId: row.id,
    },
  });
  return { version: 1, organizationId: row.organizationId, eventId: event.id };
}
