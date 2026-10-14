// Opt-in observations only: no test deadlines, mocks, timers or assertions change.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { threadId } from 'node:worker_threads';
import { afterAll, beforeAll, expect } from 'vitest';

const directory = process.env.TEST_STABILITY_DIAGNOSTICS;
if (directory) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const cpu = process.cpuUsage();
  const delay = monitorEventLoopDelay({ resolution: 20 });
  const memoryStart = process.memoryUsage();
  let setupSeconds = 0;
  delay.enable();
  beforeAll(() => {
    setupSeconds = (performance.now() - started) / 1000;
  });
  afterAll(() => {
    delay.disable();
    const finishedAt = new Date().toISOString();
    const file = expect.getState().testPath;
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, `${process.pid}-${threadId}-${performance.timeOrigin}-${started}.json`),
      JSON.stringify({
        file,
        pid: process.pid,
        threadId,
        startedAt,
        finishedAt,
        setupSeconds,
        monotonicSeconds: (performance.now() - started) / 1000,
        wallSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000,
        cpuMicros: process.cpuUsage(cpu),
        eventLoopMaxMs: delay.max / 1e6,
        eventLoopP99Ms: delay.percentile(99) / 1e6,
        memoryStart,
        memoryEnd: process.memoryUsage(),
        resourceUsage: process.resourceUsage(),
      }),
    );
  });
}
