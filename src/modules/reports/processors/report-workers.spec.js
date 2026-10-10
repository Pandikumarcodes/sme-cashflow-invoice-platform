import { jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ReportWorkers } from './report-workers.js';
import { QUEUE_NAMES } from '../../../infrastructure/queues/queue-names.js';
describe('report worker transport boundary', () => {
  const job = {
    name: 'event',
    data: { version: 1, organizationId: randomUUID(), eventId: randomUUID() },
  };
  it('uses the canonical queue and existing dispatcher for only its owning event', async () => {
    const dispatcher = {
      dispatch: jest.fn(async (events, route) => {
        expect(events).toEqual(['REPORT_EXPORT_REQUESTED']);
        expect(route()).toBe(QUEUE_NAMES.REPORTS_GENERATE);
      }),
    };
    await new ReportWorkers({}, {}, dispatcher, {}).process({
      name: 'dispatch',
      data: { version: 1 },
    });
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { name: 'event', data: { ...job.data, total: 'spoof' } },
    { name: 'other', data: job.data },
    { name: 'dispatch', data: { version: 2 } },
  ])('permanently rejects malformed routing %j', async (input) => {
    await expect(new ReportWorkers({}, {}, {}, {}).process(input)).rejects.toThrow(
      'INVALID_REPORT_JOB',
    );
  });
  it('never forwards sensitive persistence exceptions into BullMQ', async () => {
    const generation = {
      handleEvent: jest.fn(async () => {
        throw new Error('SQL password report body');
      }),
    };
    await expect(new ReportWorkers({}, {}, {}, generation).process(job)).rejects.toThrow(
      'REPORT_WORK_UNAVAILABLE',
    );
    expect(generation.handleEvent).toHaveBeenCalledWith(job.data);
  });
});
