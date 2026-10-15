import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { freemem, totalmem, availableParallelism } from 'node:os';
import { holdWindowsAwake } from './windows-awake.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Match vitest.config.ts; single-worker plans explicitly override this policy.
const frontendWorkers = process.platform === 'win32' ? 1 : 2;
const plans = {
  typecheck: ['frontend', ['run', 'typecheck'], 120, 1],
  lint: ['frontend', ['run', 'lint'], 120, 1],
  format: ['frontend', ['run', 'format:check'], 120, 1],
  build: ['frontend', ['run', 'build'], 120, 1],
  size: ['frontend', ['run', 'size:initial'], 60, 1],
  'backend-build': ['backend', ['run', 'build'], 120, 1],
  inventory: ['backend', ['run', 'verify:api-inventory'], 120, 1],
  migrations: ['backend', ['run', 'db:migrate:status:test'], 120, 1],
  dependencies: ['backend', ['--env-file=.env', 'scripts/diagnose-test-dependencies.js'], 30, 1],
  regression: [
    'frontend',
    [
      'run',
      'test',
      '--',
      'src/test/api-context-lifecycle.test.ts',
      'src/features/dashboard/DashboardPage.test.tsx',
      'src/features/reports/ReportsPage.test.tsx',
    ],
    300,
    frontendWorkers,
  ],
  'backend-lint': ['backend', ['run', 'lint'], 120, 1],
  'backend-format': ['backend', ['run', 'format:check'], 120, 1],
  focused: [
    'frontend',
    [
      'run',
      'test',
      '--',
      'src/features/auth/AuthPages.test.tsx',
      'src/features/invoices/InvoicePages.test.tsx',
      'src/features/dashboard/DashboardPage.test.tsx',
      'src/features/financials/FinancialPages.test.tsx',
    ],
    300,
    frontendWorkers,
  ],
  cleanup: [
    'frontend',
    ['run', 'test', '--', 'src/test/api-context-lifecycle.test.ts'],
    120,
    frontendWorkers,
  ],
  default: ['frontend', ['run', 'test'], 300, frontendWorkers],
  threads: ['frontend', ['run', 'test', '--', '--pool=threads'], 300, frontendWorkers],
  dashboard: [
    'frontend',
    ['run', 'test', '--', 'src/features/dashboard/DashboardPage.test.tsx'],
    120,
    frontendWorkers,
  ],
  reports: [
    'frontend',
    ['run', 'test', '--', 'src/features/reports/ReportsPage.test.tsx'],
    120,
    frontendWorkers,
  ],
  invoices: [
    'frontend',
    ['run', 'test', '--', 'src/features/invoices/InvoicePages.test.tsx'],
    120,
    frontendWorkers,
  ],
  expenses: [
    'frontend',
    ['run', 'test', '--', 'src/features/expenses/ExpensePages.test.tsx'],
    120,
    frontendWorkers,
  ],
  payments: [
    'frontend',
    ['run', 'test', '--', 'src/features/payments/PaymentPages.test.tsx'],
    120,
    frontendWorkers,
  ],
  single: ['frontend', ['run', 'test', '--', '--pool=forks', '--maxWorkers=1'], 300, 1],
  // The prior 480-second attempt completed 8/17 scenarios, all green, on this host.
  // Bound the full scenario count; browser assertion/test deadlines stay unchanged.
  browser: ['frontend', ['run', 'test:e2e'], 900, 1],
  preview: ['frontend', ['run', 'test:e2e:preview'], 180, 1],
  live: ['frontend', ['run', 'test:e2e:live'], 480, 1],
  'auth-http': ['backend', ['run', 'test:e2e', '--', 'auth.e2e-spec.js'], 180, 1],
  'auth-db': [
    'backend',
    ['run', 'test:integration', '--', 'auth-persistence.integration-spec.js'],
    180,
    1,
  ],
  'backend-unit': ['backend', ['run', 'test'], 180, 1],
  'backend-db': ['backend', ['run', 'test:integration'], 300, 1],
  'backend-http': ['backend', ['run', 'test:e2e'], 300, 1],
  'backend-queues': ['backend', ['run', 'test:queues'], 300, 1],
};
const name = process.argv[2];
const repetitions = Number(process.argv[3] ?? 1);
if (!plans[name] || !Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
  throw new Error(
    `Usage: node scripts/verify-remediation.mjs <${Object.keys(plans).join('|')}> [1-5]`,
  );
}
const [app, args, budgetSeconds, workers] = plans[name];
const directory = resolve(root, 'frontend/test-results/remediation');
await mkdir(directory, { recursive: true });
const cleanupMarker = resolve(directory, '.pending-cleanup');
const nonTestPlans = [
  'typecheck',
  'lint',
  'format',
  'size',
  'inventory',
  'migrations',
  'dependencies',
  'backend-lint',
  'backend-format',
  'build',
  'backend-build',
];
if (existsSync(cleanupMarker) && !nonTestPlans.includes(name)) {
  throw new Error(
    'BLOCKED: previous test tree cleanup is unverified. Inspect owned processes and remove test-results/remediation/.pending-cleanup only after confirming cleanup.',
  );
}
const npm =
  process.env.npm_execpath ??
  realpathSync(
    resolve(
      dirname(process.execPath),
      process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : 'npm',
    ),
  );
let failed = false;
const awake = await holdWindowsAwake();
const awakeStartedAt = new Date().toISOString();
const awakeActiveAtStart = awake.active;
try {
  for (let attempt = 1; attempt <= repetitions; attempt += 1) {
    if (process.platform === 'win32' && !awake.active) {
      throw new Error('Windows awake helper stopped; verification canceled.');
    }
    const startedAt = new Date().toISOString();
    const id = `${startedAt.replaceAll(/[:.]/g, '-')}-${name}-${attempt}`;
    const log = resolve(directory, `${id}.log`);
    const started = performance.now();
    const scheduler = monitorEventLoopDelay({ resolution: 100 });
    scheduler.enable();
    const freeMemoryStart = freemem();
    let freeMemoryMin = freeMemoryStart;
    let sampleCount = 0;
    let lastResourceSample = started;
    let maxResourceSampleGapMs = 0;
    const resourceSampler = setInterval(() => {
      const now = performance.now();
      maxResourceSampleGapMs = Math.max(maxResourceSampleGapMs, now - lastResourceSample);
      lastResourceSample = now;
      freeMemoryMin = Math.min(freeMemoryMin, freemem());
      sampleCount += 1;
    }, 1000);
    const commandArgs = [...args];
    if (['live', 'browser', 'preview'].includes(name))
      commandArgs.push('--', '--output', resolve(directory, id, 'browser'));
    const child = spawn(
      process.execPath,
      name === 'dependencies' ? commandArgs : [npm, ...commandArgs],
      {
        cwd: resolve(root, app),
        env: {
          ...process.env,
          NO_COLOR: '1',
          REMEDIATION_REPORT_DIRECTORY: resolve(directory, id, 'html'),
          TEST_STABILITY_DIAGNOSTICS: resolve(directory, id, 'workers'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      },
    );
    let writes = Promise.resolve();
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk) => {
        writes = writes.then(() => appendFile(log, chunk));
      });
    }
    let timedOut = false;
    let terminationExitCode = null;
    let watchdogElapsedSeconds = null;
    let terminationSeconds = null;
    let resolveTimeout;
    const timeoutResult = new Promise((resolveResult) => {
      resolveTimeout = resolveResult;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      watchdogElapsedSeconds = (performance.now() - started) / 1000;
      const terminationStarted = performance.now();
      // Only this run's child tree is terminated; never search for ports/process names.
      if (process.platform === 'win32')
        terminationExitCode = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 10_000,
        }).status;
      else {
        try {
          process.kill(-child.pid, 'SIGKILL');
          terminationExitCode = 0;
        } catch {
          terminationExitCode = 1;
        }
      }
      // Do not wait indefinitely for inherited pipes after a failed/slow tree kill.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      terminationSeconds = (performance.now() - terminationStarted) / 1000;
      resolveTimeout({ exitCode: null, signal: 'TIMEOUT' });
    }, budgetSeconds * 1000);
    const completion = new Promise((resolveResult) => {
      child.on('error', () => resolveResult({ exitCode: null, signal: null, launchError: true }));
      child.on('close', (exitCode, signal) => resolveResult({ exitCode, signal }));
    });
    const result = await Promise.race([completion, timeoutResult]);
    clearTimeout(timer);
    clearInterval(resourceSampler);
    maxResourceSampleGapMs = Math.max(
      maxResourceSampleGapMs,
      performance.now() - lastResourceSample,
    );
    scheduler.disable();
    await writes;
    const output = stripVTControlCharacters(await readFile(log, 'utf8').catch(() => ''));
    const summary = output
      .split(/\r?\n/)
      .filter((line) =>
        /^\s*(Tests|Test Files|Test Suites|\d+ (passed|failed|skipped))\b/.test(line),
      )
      .map((line) => line.trim());
    const resultLine =
      summary.find((line) => /^Tests\b/.test(line)) ??
      summary.find((line) => /^\d+ (passed|failed|skipped)/.test(line)) ??
      '';
    const reported = Object.fromEntries(
      [...resultLine.matchAll(/(\d+)\s+(passed|failed|skipped)/g)].map((match) => [
        match[2],
        Number(match[1]),
      ]),
    );
    const browserOutput = ['live', 'browser', 'preview'].includes(name) ? output : '';
    const browserPasses = browserOutput
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:ok|✓|✔)\s+\d+\b/.test(line)).length;
    const browserFailures = browserOutput
      .split(/\r?\n/)
      .filter((line) => /^\s*(?:x|×|✘)\s+\d+\b/.test(line)).length;
    const finishedAt = new Date().toISOString();
    const evidence = {
      id,
      app,
      command: `${name === 'dependencies' ? 'node' : 'npm.cmd'} ${commandArgs.join(' ')}`,
      startedAt,
      finishedAt,
      monotonicSeconds: Number(((performance.now() - started) / 1000).toFixed(3)),
      wallSeconds: (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000,
      budgetSeconds,
      workers,
      awakeGuard: { active: awake.active, pid: awake.pid, startupMs: awake.startupMs ?? null },
      pid: child.pid,
      ...result,
      status: timedOut ? 'TIMEOUT' : result.exitCode === 0 ? 'PASS' : 'FAIL',
      summary,
      counts: {
        passed: reported.passed ?? browserPasses,
        failed: reported.failed ?? browserFailures,
        skipped: reported.skipped ?? 0,
      },
      timedOutAssertions: (output.match(/(?:Test|Hook) timed out in/g) ?? []).length,
      terminatedPid: timedOut ? child.pid : null,
      terminationExitCode,
      watchdogElapsedSeconds,
      terminationSeconds,
      parentEventLoopMaxMs: Number((scheduler.max / 1e6).toFixed(3)),
      resources: {
        totalMemoryBytes: totalmem(),
        freeMemoryStartBytes: freeMemoryStart,
        freeMemoryMinBytes: freeMemoryMin,
        freeMemoryEndBytes: freemem(),
        sampleCount,
        maxResourceSampleGapMs,
        availableParallelism: availableParallelism(),
        workerDiagnostics: resolve(directory, id, 'workers'),
      },
      database: [
        'live',
        'auth-http',
        'auth-db',
        'backend-db',
        'backend-http',
        'backend-queues',
        'migrations',
      ].includes(name)
        ? 'guarded local sme_cashflow_test'
        : 'none',
      browser: ['live', 'browser', 'preview'].includes(name)
        ? process.env.CI
          ? 'Chromium headless'
          : 'Edge headless'
        : 'none',
      node: process.version,
      platform: process.platform,
      conditions: {
        CI: process.env.CI === 'true',
        NODE_ENV: process.env.NODE_ENV ?? 'unset',
        heavySuites: 'run sequentially; external host activity uncontrolled',
      },
      log,
    };
    await writeFile(resolve(directory, `${id}.json`), JSON.stringify(evidence, null, 2));
    if (timedOut && terminationExitCode !== 0) {
      await writeFile(
        cleanupMarker,
        JSON.stringify({ id, pid: child.pid, status: 'cleanup unverified' }),
      );
    }
    console.info(JSON.stringify(evidence));
    failed ||= evidence.status !== 'PASS';
    // A timeout ends this batch. Failures remain recorded and later bounded attempts run.
    if (timedOut) break;
  }
} finally {
  const release = await awake.release();
  await writeFile(
    resolve(directory, `${awakeStartedAt.replaceAll(/[:.]/g, '-')}-${name}-awake.json`),
    JSON.stringify(
      {
        startedAt: awakeStartedAt,
        finishedAt: new Date().toISOString(),
        pid: awake.pid,
        activeAtStart: awakeActiveAtStart,
        activeAfterRelease: awake.active,
        ...release,
      },
      null,
      2,
    ),
  );
  failed ||= release.exitCode !== 0;
}
process.exitCode = failed ? 1 : 0;
