# Production readiness remediation

Verification date: 2026-10-14, Asia/Calcutta. Evidence timestamps below use UTC.
This is a bounded local investigation, not a deployment assessment. Historical
PASS results from Prompt 12 are not counted as current verification.

## 1. Initial Repository State

`git status --short` returned no entries. Initial `git diff --check` passed.
There was no uncommitted Prompt 10–12 work to merge or discard. Existing tracked
features, fixtures, documentation, ignored browser artifacts and local environment
files were preserved. No staging, commit, reset, clean, migration or deployment
was performed.

Read AGENTS.md, root/frontend/backend READMEs, repository blueprint, API
contracts/inventory, domain rules, authorization design, and both existing
production-readiness reports. The existing readiness reports were not overwritten.

## 2. Original Reliability Findings

Historical HIGH findings: intermittent registration HTTP 500; a slow expense
detail read with server-side 5xx; default/component-suite timing failures; and
one recorded 18,228.08-second execution. Those reports did not establish causes.
Production HTTPS/cookies/CORS/shared storage and manual accessibility were also
unverified. These historical results are context, not fresh failures or passes.

## 3. Root-Cause Investigation

**Confirmed observations and bounded defects:**

- Fresh focused baseline failed Dashboard's `beforeAll` cold import deadline;
  17 tests were skipped by the runner, not disabled in source. Moving that
  existing preload to a static test-module import removes this particular hook
  deadline. Later assertion failures demonstrate that this is not a complete
  test-stability fix.
- Live financial journeys created API request contexts that were disposed only
  on successful completion. Assertion/setup failures bypassed those calls.
  Fixture ownership now guarantees attempted disposal of every acquired context.
  This defect is not proven to have caused the historical registration/read 500.
- Initial PostgreSQL and Redis TCP connections were refused outside the sandbox.
  Auth HTTP tests failed in guarded database setup, before registration requests.
- The supplied 548-test/27-suite count is historical. The unchanged starting
  repository contains 566 tests/28 suites, including onboarding coverage.

**Supported hypotheses:** costly cold dependency work and host scheduling/resource
conditions contribute to deadline sensitivity. A successful single-worker run
and multiple parallel failures support investigating orchestration, but do not
prove parallelism is the sole cause. The outside-sandbox focused comparison also
failed; sandboxing alone is not sufficient explanation.

**Unresolved:** historical registration/read 5xx causes; pool exhaustion,
transaction expiry, lock contention, DB interruptions, sleep/resume or wall-clock
changes behind the multi-hour anomaly. No fresh authenticated 500 was reproduced
while dependencies were initially unavailable. Later authenticated verification passes are recorded below. No application retry, timeout, authentication,
financial or schema adjustment is justified by this evidence.

Registration trace: allowlisted RegisterDto validation → thin AuthController →
AuthService normalization and Argon2id hashing outside the transaction → one
Prisma transaction creates User and mandatory audit → commit → safe User mapper.
No organization or session is created. Existing P2002 handling maps duplicate
email to the documented conflict; other failures retain the safe error envelope.
Current authentication/session and tenant authorization continue to reload database
state. Prisma initialization owns one client promise and shutdown disconnects it.

## 4. Reproduction Evidence

Bounded strategy: affected suites first, full default and single-worker comparisons,
then sequential checks/browser execution. Unit command budget is 300 seconds;
guarded live is 480 seconds; individual test/hook/assertion deadlines and zero
retries are unchanged. Initial diagnosis targeted approximately one hour. Recovery of dependencies and a demonstrated cleanup defect justified a bounded extension for full guarded backend verification and final live/browser runs. Every command retained its recorded budget and evidence; no unrecorded repetition continued. Browser command budget changed from 360 to 480 seconds after observing 14 progressing scenarios; test/assertion deadlines stayed unchanged.

Every wrapper attempt produces unique ignored `.log`/`.json` files under
`frontend/test-results/remediation/`. JSON records command, UTC start/finish,
wall/monotonic duration, exit status, workers, database/browser mode, PID, summary,
and any termination attempt. Later attempts also measure the parent's maximum
event-loop delay; this is not a measurement of a Vitest worker's event loop.
Failed runs remain in the sequence. PASS means the command exited zero, not that
all release gates passed.

The second single-worker run exceeded its 300-second command budget and ended
after 502.98 seconds with only 532 tests reported (522 passed, 10 failed).
The third planned repetition was not executed because timeout ends the batch.
Its old wrapper did not bound Windows tree termination or inherited-pipe closure;
the wrapper now bounds termination to ten seconds and races timeout against
completion. Subsequent scoped inspection found no remaining test Node processes.
The old record does not capture termination-command exit status, so it does not
prove whether termination delay or host scheduling caused the overrun. Captured
wall/monotonic clocks agree closely; this does not establish the historical
18,228-second cause or reproduce a multi-hour discontinuity.

<!-- ATTEMPTS -->
| Attempt / command (application cwd) | UTC start → finish | Wall / monotonic seconds | Exit / status | Results / evidence |
| --- | --- | ---: | --- | --- |
| 2026-10-14T04-57-36-853Z-focused-1<br>frontend: `npm.cmd run test -- src/features/auth/AuthPages.test.tsx src/features/invoices/InvoicePages.test.tsx src/features/dashboard/DashboardPage.test.tsx src/features/financials/FinancialPages.test.tsx` | 2026-10-14T04:57:36.853Z → 2026-10-14T04:59:52.225Z | 135.372 / 135.363 | 1 / **FAIL** | Test Files  1 failed / 3 passed (4); Tests  65 passed / 17 skipped (82)<br>[log](../frontend/test-results/remediation/2026-10-14T04-57-36-853Z-focused-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T04-57-36-853Z-focused-1.json) |
| 2026-10-14T05-03-07-578Z-default-1<br>frontend: `npm.cmd run test` | 2026-10-14T05:03:07.578Z → 2026-10-14T05:06:05.329Z | 177.751 / 177.732 | 1 / **FAIL** | Test Files  1 failed / 27 passed (28); Tests  1 failed / 565 passed (566)<br>[log](../frontend/test-results/remediation/2026-10-14T05-03-07-578Z-default-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-03-07-578Z-default-1.json) |
| 2026-10-14T05-03-27-860Z-backend-build-1<br>backend: `npm.cmd run build` | 2026-10-14T05:03:27.860Z → 2026-10-14T05:04:09.586Z | 41.726 / 41.724 | 0 / **PASS** | Successfully compiled 223 files with Babel (26748ms).<br>[log](../frontend/test-results/remediation/2026-10-14T05-03-27-860Z-backend-build-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-03-27-860Z-backend-build-1.json) |
| 2026-10-14T05-06-17-747Z-migrations-1<br>backend: `npm.cmd run db:migrate:status:test` | 2026-10-14T05:06:17.747Z → 2026-10-14T05:07:05.406Z | 47.659 / 47.659 | 1 / **FAIL** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-06-17-747Z-migrations-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-06-17-747Z-migrations-1.json) |
| 2026-10-14T05-07-04-282Z-auth-http-1<br>backend: `npm.cmd run test:e2e -- auth.e2e-spec.js` | 2026-10-14T05:07:04.282Z → 2026-10-14T05:09:21.099Z | 136.817 / 136.815 | 1 / **FAIL** | Test Suites: 1 failed, 1 total; Tests:       8 failed, 8 total; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:; PrismaClientInitializationError:<br>[log](../frontend/test-results/remediation/2026-10-14T05-07-04-282Z-auth-http-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-07-04-282Z-auth-http-1.json) |
| 2026-10-14T05-08-29-440Z-migrations-1<br>backend: `npm.cmd run db:migrate:status:test` | 2026-10-14T05:08:29.440Z → 2026-10-14T05:08:36.308Z | 6.868 / 6.868 | 1 / **FAIL** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-08-29-440Z-migrations-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-08-29-440Z-migrations-1.json) |
| 2026-10-14T05-09-44-276Z-dependencies-1<br>backend: `npm.cmd exec -- node --env-file=.env scripts/diagnose-test-dependencies.js` | 2026-10-14T05:09:44.276Z → 2026-10-14T05:11:01.977Z | 77.701 / 77.701 | 1 / **TIMEOUT** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-09-44-276Z-dependencies-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-09-44-276Z-dependencies-1.json)<br>Termination attempted only on PID 21852; exit=not captured |
| 2026-10-14T05-10-03-816Z-regression-1<br>frontend: `npm.cmd run test -- src/test/api-context-lifecycle.test.ts src/features/dashboard/DashboardPage.test.tsx src/features/reports/ReportsPage.test.tsx` | 2026-10-14T05:10:03.816Z → 2026-10-14T05:11:55.711Z | 111.895 / 111.893 | 1 / **FAIL** | Test Files  2 failed / 1 passed (3); Tests  10 failed / 45 passed (55)<br>[log](../frontend/test-results/remediation/2026-10-14T05-10-03-816Z-regression-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-10-03-816Z-regression-1.json) |
| 2026-10-14T05-16-26-875Z-single-1<br>frontend: `npm.cmd run test -- --pool=forks --maxWorkers=1` | 2026-10-14T05:16:26.875Z → 2026-10-14T05:21:15.840Z | 288.965 / 288.944 | 0 / **PASS** | Test Files  29 passed (29); Tests  568 passed (568)<br>[log](../frontend/test-results/remediation/2026-10-14T05-16-26-875Z-single-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-16-26-875Z-single-1.json) |
| 2026-10-14T05-21-15-853Z-single-2<br>frontend: `npm.cmd run test -- --pool=forks --maxWorkers=1` | 2026-10-14T05:21:15.853Z → 2026-10-14T05:29:38.838Z | 502.985 / 502.984 | 1 / **TIMEOUT** | Test Files  3 failed / 24 passed (27); Tests  10 failed / 522 passed (532)<br>[log](../frontend/test-results/remediation/2026-10-14T05-21-15-853Z-single-2.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-21-15-853Z-single-2.json)<br>Termination attempted only on PID 12828; exit=not captured |
| 2026-10-14T05-32-41-184Z-default-1<br>frontend: `npm.cmd run test` | 2026-10-14T05:32:41.184Z → 2026-10-14T05:37:13.403Z | 272.219 / 272.207 | 1 / **FAIL** | Test Files  5 failed / 24 passed (29); Tests  5 failed / 563 passed (568)<br>[log](../frontend/test-results/remediation/2026-10-14T05-32-41-184Z-default-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-32-41-184Z-default-1.json)<br>Parent max event-loop delay 414.974 ms |
| 2026-10-14T05-37-13-430Z-default-2<br>frontend: `npm.cmd run test` | 2026-10-14T05:37:13.430Z → 2026-10-14T05:40:10.881Z | 177.451 / 177.45 | 1 / **FAIL** | Test Files  2 failed / 27 passed (29); Tests  2 failed / 566 passed (568)<br>[log](../frontend/test-results/remediation/2026-10-14T05-37-13-430Z-default-2.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-37-13-430Z-default-2.json)<br>Parent max event-loop delay 254.804 ms |
| 2026-10-14T05-40-10-894Z-default-3<br>frontend: `npm.cmd run test` | 2026-10-14T05:40:10.894Z → 2026-10-14T05:42:41.421Z | 150.527 / 150.528 | 1 / **FAIL** | Test Files  1 failed / 28 passed (29); Tests  1 failed / 567 passed (568)<br>[log](../frontend/test-results/remediation/2026-10-14T05-40-10-894Z-default-3.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-40-10-894Z-default-3.json)<br>Parent max event-loop delay 519.832 ms |
| 2026-10-14T05-42-41-428Z-default-4<br>frontend: `npm.cmd run test` | 2026-10-14T05:42:41.428Z → 2026-10-14T05:44:37.372Z | 115.944 / 115.944 | 1 / **FAIL** | Test Files  1 failed / 28 passed (29); Tests  1 failed / 567 passed (568)<br>[log](../frontend/test-results/remediation/2026-10-14T05-42-41-428Z-default-4.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-42-41-428Z-default-4.json)<br>Parent max event-loop delay 165.282 ms |
| 2026-10-14T05-45-17-279Z-typecheck-1<br>frontend: `npm.cmd run typecheck` | 2026-10-14T05:45:17.279Z → 2026-10-14T05:45:28.908Z | 11.629 / 11.629 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-45-17-279Z-typecheck-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-45-17-279Z-typecheck-1.json)<br>Parent max event-loop delay 129.499 ms |
| 2026-10-14T05-45-29-006Z-lint-1<br>frontend: `npm.cmd run lint` | 2026-10-14T05:45:29.006Z → 2026-10-14T05:46:13.612Z | 44.606 / 44.604 | 1 / **FAIL** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-45-29-006Z-lint-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-45-29-006Z-lint-1.json)<br>Parent max event-loop delay 118.817 ms |
| 2026-10-14T05-46-13-710Z-format-1<br>frontend: `npm.cmd run format:check` | 2026-10-14T05:46:13.710Z → 2026-10-14T05:46:17.756Z | 4.046 / 4.039 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-46-13-710Z-format-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-46-13-710Z-format-1.json)<br>Parent max event-loop delay 115.606 ms |
| 2026-10-14T05-46-17-836Z-build-1<br>frontend: `npm.cmd run build` | 2026-10-14T05:46:17.836Z → 2026-10-14T05:46:36.084Z | 18.248 / 18.248 | 0 / **PASS** | ✓ built in 5.73s<br>[log](../frontend/test-results/remediation/2026-10-14T05-46-17-836Z-build-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-46-17-836Z-build-1.json)<br>Parent max event-loop delay 127.402 ms |
| 2026-10-14T05-46-36-344Z-size-1<br>frontend: `npm.cmd run size:initial` | 2026-10-14T05:46:36.344Z → 2026-10-14T05:46:37.213Z | 0.869 / 0.867 | 0 / **PASS** | Initial static graph: 474.02 kB; gzip sum 144.81 kB.<br>[log](../frontend/test-results/remediation/2026-10-14T05-46-36-344Z-size-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-46-36-344Z-size-1.json)<br>Parent max event-loop delay 114.557 ms |
| 2026-10-14T05-46-37-330Z-backend-unit-1<br>backend: `npm.cmd run test` | 2026-10-14T05:46:37.330Z → 2026-10-14T05:47:08.634Z | 31.304 / 31.301 | 0 / **PASS** | Test Suites: 48 passed, 48 total; Tests:       308 passed, 308 total<br>[log](../frontend/test-results/remediation/2026-10-14T05-46-37-330Z-backend-unit-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-46-37-330Z-backend-unit-1.json)<br>Parent max event-loop delay 132.71 ms |
| 2026-10-14T05-47-08-789Z-inventory-1<br>backend: `npm.cmd run verify:api-inventory` | 2026-10-14T05:47:08.789Z → 2026-10-14T05:47:11.590Z | 2.801 / 2.8 | 0 / **PASS** | API inventory verified: 65 implemented routes, 65 documented routes.<br>[log](../frontend/test-results/remediation/2026-10-14T05-47-08-789Z-inventory-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-47-08-789Z-inventory-1.json)<br>Parent max event-loop delay 114.36 ms |
| 2026-10-14T05-47-11-684Z-backend-lint-1<br>backend: `npm.cmd run lint` | 2026-10-14T05:47:11.684Z → 2026-10-14T05:47:33.967Z | 22.283 / 22.282 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-47-11-684Z-backend-lint-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-47-11-684Z-backend-lint-1.json)<br>Parent max event-loop delay 122.159 ms |
| 2026-10-14T05-47-34-152Z-backend-format-1<br>backend: `npm.cmd run format:check` | 2026-10-14T05:47:34.152Z → 2026-10-14T05:47:39.737Z | 5.585 / 5.583 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-47-34-152Z-backend-format-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-47-34-152Z-backend-format-1.json)<br>Parent max event-loop delay 118.751 ms |
| 2026-10-14T05-47-54-415Z-lint-1<br>frontend: `npm.cmd run lint` | 2026-10-14T05:47:54.415Z → 2026-10-14T05:48:23.281Z | 28.866 / 28.859 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-47-54-415Z-lint-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-47-54-415Z-lint-1.json)<br>Parent max event-loop delay 119.21 ms |
| 2026-10-14T05-48-23-491Z-typecheck-1<br>frontend: `npm.cmd run typecheck` | 2026-10-14T05:48:23.491Z → 2026-10-14T05:48:41.789Z | 18.298 / 18.297 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-48-23-491Z-typecheck-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-48-23-491Z-typecheck-1.json)<br>Parent max event-loop delay 112.525 ms |
| 2026-10-14T05-48-41-903Z-format-1<br>frontend: `npm.cmd run format:check` | 2026-10-14T05:48:41.903Z → 2026-10-14T05:48:49.567Z | 7.664 / 7.663 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-48-41-903Z-format-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-48-41-903Z-format-1.json)<br>Parent max event-loop delay 112.263 ms |
| 2026-10-14T05-48-49-792Z-cleanup-1<br>frontend: `npm.cmd run test -- src/test/api-context-lifecycle.test.ts` | 2026-10-14T05:48:49.792Z → 2026-10-14T05:48:54.689Z | 4.897 / 4.896 | 0 / **PASS** | Test Files  1 passed (1); Tests  2 passed (2)<br>[log](../frontend/test-results/remediation/2026-10-14T05-48-49-792Z-cleanup-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-48-49-792Z-cleanup-1.json)<br>Parent max event-loop delay 112.001 ms |
| 2026-10-14T05-48-54-777Z-browser-1<br>frontend: `npm.cmd run test:e2e -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T05-48-54-777Z-browser-1\browser` | 2026-10-14T05:48:54.777Z → 2026-10-14T05:54:54.985Z | 360.208 / 360.208 | none / **TIMEOUT** | 14 browser scenarios completed before command timeout; no final runner summary<br>[log](../frontend/test-results/remediation/2026-10-14T05-48-54-777Z-browser-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-48-54-777Z-browser-1.json)<br>Termination attempted only on PID 30208; exit=1<br>Parent max event-loop delay 181.535 ms |
| 2026-10-14T05-54-55-743Z-preview-1<br>frontend: `npm.cmd run test:e2e:preview -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T05-54-55-743Z-preview-1\browser` | 2026-10-14T05:54:55.743Z → 2026-10-14T05:55:06.070Z | 10.327 / 10.313 | 1 / **FAIL** | <br>[log](../frontend/test-results/remediation/2026-10-14T05-54-55-743Z-preview-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-54-55-743Z-preview-1.json)<br>Parent max event-loop delay 129.761 ms |
| 2026-10-14T05-55-06-182Z-live-1<br>frontend: `npm.cmd run test:e2e:live -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T05-55-06-182Z-live-1\browser` | 2026-10-14T05:55:06.182Z → 2026-10-14T06:03:06.452Z | 480.27 / 480.27 | none / **TIMEOUT** | 3 browser scenarios completed before command timeout; no final runner summary<br>[log](../frontend/test-results/remediation/2026-10-14T05-55-06-182Z-live-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T05-55-06-182Z-live-1.json)<br>Termination attempted only on PID 10720; exit=1<br>Parent max event-loop delay 178.258 ms |
| 2026-10-14T06-27-07-185Z-migrations-1<br>backend: `npm.cmd run db:migrate:status:test` | 2026-10-14T06:27:07.185Z → 2026-10-14T06:27:54.565Z | 47.38 / 47.367 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T06-27-07-185Z-migrations-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-27-07-185Z-migrations-1.json)<br>Parent max event-loop delay 233.964 ms |
| 2026-10-14T06-27-54-859Z-auth-http-1<br>backend: `npm.cmd run test:e2e -- auth.e2e-spec.js` | 2026-10-14T06:27:54.859Z → 2026-10-14T06:28:59.335Z | 64.476 / 64.474 | 0 / **PASS** | Test Suites: 1 passed, 1 total; Tests:       8 passed, 8 total<br>[log](../frontend/test-results/remediation/2026-10-14T06-27-54-859Z-auth-http-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-27-54-859Z-auth-http-1.json)<br>Parent max event-loop delay 425.722 ms |
| 2026-10-14T06-28-59-546Z-backend-db-1<br>backend: `npm.cmd run test:integration` | 2026-10-14T06:28:59.546Z → 2026-10-14T06:33:04.320Z | 244.774 / 244.773 | 0 / **PASS** | Test Suites: 15 passed, 15 total; Tests:       134 passed, 134 total<br>[log](../frontend/test-results/remediation/2026-10-14T06-28-59-546Z-backend-db-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-28-59-546Z-backend-db-1.json)<br>Parent max event-loop delay 264.897 ms |
| 2026-10-14T06-33-04-554Z-backend-http-1<br>backend: `npm.cmd run test:e2e` | 2026-10-14T06:33:04.554Z → 2026-10-14T06:35:58.615Z | 174.061 / 174.06 | 0 / **PASS** | Test Suites: 14 passed, 14 total; Tests:       77 passed, 77 total<br>[log](../frontend/test-results/remediation/2026-10-14T06-33-04-554Z-backend-http-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-33-04-554Z-backend-http-1.json)<br>Parent max event-loop delay 234.881 ms |
| 2026-10-14T06-35-59-154Z-backend-queues-1<br>backend: `npm.cmd run test:queues` | 2026-10-14T06:35:59.154Z → 2026-10-14T06:36:38.472Z | 39.318 / 39.318 | 0 / **PASS** | Test Suites: 3 passed, 3 total; Tests:       8 passed, 8 total<br>[log](../frontend/test-results/remediation/2026-10-14T06-35-59-154Z-backend-queues-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-35-59-154Z-backend-queues-1.json)<br>Parent max event-loop delay 147.194 ms |
| 2026-10-14T06-46-16-510Z-live-1<br>frontend: `npm.cmd run test:e2e:live -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T06-46-16-510Z-live-1\browser` | 2026-10-14T06:46:16.510Z → 2026-10-14T06:47:37.440Z | 80.93 / 80.92 | 0 / **PASS** | 3 passed (1.3m)<br>[log](../frontend/test-results/remediation/2026-10-14T06-46-16-510Z-live-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-46-16-510Z-live-1.json)<br>Parent max event-loop delay 140.64 ms |
| 2026-10-14T06-47-37-449Z-live-2<br>frontend: `npm.cmd run test:e2e:live -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T06-47-37-449Z-live-2\browser` | 2026-10-14T06:47:37.449Z → 2026-10-14T06:49:04.482Z | 87.033 / 87.034 | 0 / **PASS** | 3 passed (1.4m)<br>[log](../frontend/test-results/remediation/2026-10-14T06-47-37-449Z-live-2.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-47-37-449Z-live-2.json)<br>Parent max event-loop delay 201.982 ms |
| 2026-10-14T06-49-04-486Z-live-3<br>frontend: `npm.cmd run test:e2e:live -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T06-49-04-486Z-live-3\browser` | 2026-10-14T06:49:04.486Z → 2026-10-14T06:50:26.471Z | 81.985 / 81.984 | 0 / **PASS** | 3 passed (1.3m)<br>[log](../frontend/test-results/remediation/2026-10-14T06-49-04-486Z-live-3.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-49-04-486Z-live-3.json)<br>Parent max event-loop delay 238.682 ms |
| 2026-10-14T06-50-26-823Z-browser-1<br>frontend: `npm.cmd run test:e2e -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T06-50-26-823Z-browser-1\browser` | 2026-10-14T06:50:26.823Z → 2026-10-14T06:56:45.408Z | 378.585 / 378.583 | 0 / **PASS** | 17 passed (6.3m)<br>[log](../frontend/test-results/remediation/2026-10-14T06-50-26-823Z-browser-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-50-26-823Z-browser-1.json)<br>Parent max event-loop delay 416.547 ms |
| 2026-10-14T06-56-45-713Z-preview-1<br>frontend: `npm.cmd run test:e2e:preview -- --output C:\Users\Pandikumar\Desktop\SME\sme-cashflow-invoice-platform\frontend\test-results\remediation\2026-10-14T06-56-45-713Z-preview-1\browser` | 2026-10-14T06:56:45.713Z → 2026-10-14T06:56:58.622Z | 12.909 / 12.908 | 0 / **PASS** | 2 passed (10.7s)<br>[log](../frontend/test-results/remediation/2026-10-14T06-56-45-713Z-preview-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T06-56-45-713Z-preview-1.json)<br>Parent max event-loop delay 180.093 ms |
| 2026-10-14T07-04-19-924Z-lint-1<br>frontend: `npm.cmd run lint` | 2026-10-14T07:04:19.924Z → 2026-10-14T07:05:08.244Z | 48.32 / 48.311 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T07-04-19-924Z-lint-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T07-04-19-924Z-lint-1.json)<br>Parent max event-loop delay 224.395 ms |
| 2026-10-14T07-05-08-731Z-format-1<br>frontend: `npm.cmd run format:check` | 2026-10-14T07:05:08.731Z → 2026-10-14T07:05:24.587Z | 15.856 / 15.853 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T07-05-08-731Z-format-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T07-05-08-731Z-format-1.json)<br>Parent max event-loop delay 155.845 ms |
| 2026-10-14T07-05-24-721Z-backend-lint-1<br>backend: `npm.cmd run lint` | 2026-10-14T07:05:24.721Z → 2026-10-14T07:06:06.566Z | 41.845 / 41.845 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T07-05-24-721Z-backend-lint-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T07-05-24-721Z-backend-lint-1.json)<br>Parent max event-loop delay 155.714 ms |
| 2026-10-14T07-06-06-830Z-backend-format-1<br>backend: `npm.cmd run format:check` | 2026-10-14T07:06:06.830Z → 2026-10-14T07:06:18.708Z | 11.878 / 11.876 | 0 / **PASS** | <br>[log](../frontend/test-results/remediation/2026-10-14T07-06-06-830Z-backend-format-1.log) / [metadata](../frontend/test-results/remediation/2026-10-14T07-06-06-830Z-backend-format-1.json)<br>Parent max event-loop delay 117.047 ms |
<!-- /ATTEMPTS -->

The separately approved outside-sandbox focused comparison bypassed the wrapper:
runner start 10:43:45 Asia/Calcutta, runner duration 127.00s, exit 1, 42 passed /
13 failed in 3 suites. Exact process start/finish and monotonic duration were not
captured. Its genuine summary is retained in
`frontend/test-results/remediation/manual-comparison.md`; it is not a raw log.

Baseline default verification briefly overlapped the 41.72-second backend build.
That overlap is a confounder, not evidence that the build caused its Reports
failure. Subsequent heavy unit/browser suites are sequential. External host
activity is uncontrolled. Early safe process snapshots showed four pre-existing
Codex Node helpers and six Edge processes; those were not terminated. A later
test-owned Node process used about 227 MB working set and 34 accumulated CPU
seconds; these samples do not establish whole-host CPU or memory exhaustion.

## 5. Fixes Implemented

1. Static Dashboard test preload replaces the evidenced timed-out setup hook.
   Assertions, production lazy routes and all test deadlines remain intact.
2. Fixture-owned live request contexts release resources even after assertion or
   later acquisition failure; two new regression tests cover both paths.
3. Existing guarded live 5xx classification now includes request ID, timestamp,
   and status. Original backend exception mapping still executes unchanged.
   Registration assertions include the safe response request ID for correlation.
4. A bounded evidence runner preserves independent attempts, records both clocks,
   and limits timeout termination to its spawned process tree. A command timeout
   ends its batch; failed assertions do not erase earlier attempts.
5. Local Edge behavior is retained; CI selects installed Playwright Chromium.
6. Isolated CI environment generation refuses production, requires the existing
   guarded database target, generates ephemeral Ed25519 keys and refuses to
   overwrite `.env`. Dependency probes report only TCP categories.

No backend application source, schema, migration or business contract changed.

## 6. Files Created

- `.github/workflows/verification.yml`
- `backend/scripts/diagnose-test-dependencies.js`
- `backend/scripts/prepare-ci-env.js`
- `frontend/e2e/live/fixtures.ts`
- `frontend/scripts/verify-remediation.mjs`
- `frontend/src/test/api-context-lifecycle.ts`
- `frontend/src/test/api-context-lifecycle.test.ts`
- `docs/production-readiness-remediation.md`

Ignored local evidence and a temporary workflow validator are not release source.

## 7. Files Modified

- `backend/README.md`
- `frontend/README.md`
- `frontend/e2e/live-server.mjs`
- `frontend/e2e/live/workflows.spec.ts`
- `frontend/playwright.config.ts`
- `frontend/playwright.live.config.ts`
- `frontend/src/features/dashboard/DashboardPage.test.tsx`

## 8. Registration Reliability

Historical intermittent HTTP 500 remains undiagnosed. The first auth HTTP attempt failed 8/8 tests in guarded setup because PostgreSQL was unreachable, before registration requests. Initial migration checks also failed, including outside sandbox. TCP probes outside sandbox reported PostgreSQL and Redis refused at 05:11:42 UTC.

Dependencies later became available. Fresh guarded auth HTTP passes 8/8; full backend HTTP passes 77/77. Three independent live commands pass 3/3 journeys each, including normal registration, login and active protected requests. No unexpected registration 500 appeared. Their durations are 80.92s, 87.03s and 81.98s. This does not establish the historical root cause or justify a registration business-rule change.

Live fixture identities already use random UUID example.test addresses/passwords, unique namespaces and report directories. Collision was not demonstrated. The live fixture itself does not delete history; standard backend suites did reset only dedicated sme_cashflow_test through existing guarded helpers. Clearing suites and live runs remained sequential. Historical reliability diagnosis remains open despite positive fresh repetitions.

## 9. Service-Read Reliability

Reviewed reads pass through current user/session authentication, current active membership/canonical RBAC, tenant-scoped services and safe serialization. Real live journeys verified customers, invoices, payments, expenses, financial aggregates, four report previews, six worker exports/status/downloads, notifications and audit history, including A/B concealed 404 and permission 403 assertions.

Three independent live reruns passed these categories without unexpected read failures. The earlier sandbox live run also completed all 3 journeys, but its command timed out during teardown. Historical expense-detail 5xx cannot be attributed to pool exhaustion, transaction expiry, sockets or teardown from these observations. No read result is inferred from transport simulations, and no read/financial retry was added.

## 10. Frontend Test Stability

Historical baseline: **548 tests / 27 suites**. Starting repository: **566 / 28**. Two meaningful cleanup regressions bring final source to **568 / 29**. Original tests remain enabled and assertions retained.

Default: **5 attempts, 0 passes / 5 failures**. Baseline 565/566; post-change 563/568, 566/568, 567/568 and 567/568. Single-worker: **1 full pass / 1 command timeout**. Full pass 568/29 in 288.94s; timeout had a partial 532-test summary (522 passed, 10 failed) and ended after 502.98s. Third planned single-worker repetition was not run after timeout. Both final cleanup regressions pass independently.

MSW listen/reset/close, separate QueryClients, router/cache disposal, RTL cleanup and deferred-request teardown were reviewed. CSV fake timers restore real timers; leakage was not demonstrated. Existing maxWorkers=2, isolation, component/hook/assertion deadlines and zero retries remain unchanged. Static Dashboard preload eliminates the evidenced hook deadline, but passing one full run does not establish overall stability. Parent event-loop samples do not diagnose worker scheduling or the historical multi-hour anomaly.

## 11. Browser and Live Integration

Current configured counts are 17 compiled-browser scenarios, 3 live journeys and 2 preview smoke scenarios. Historical 15/2/2 counts are not reused. Compiled/preview transport simulations and real guarded API/worker journeys are distinct.

Confirmed lifecycle failure: the first compiled command hit 360s after 14 completed scenarios. Windows tree termination returned exit 1 and its owned Vite preview survived. The following preview attempt refused occupied port 4173 instead of reusing it. The sandbox live command completed all 3 journeys but reached 480s during teardown, also with failed tree termination.

Approved process inspection correlated command lines, IDs and creation timestamps. Only confirmed owned processes 732/13740 and 20880/23904/26148/6224 were stopped; subsequent checks confirmed absence. The four pre-existing Codex helpers were retained. Normal-permission live reruns completed cleanly three times. This strongly supports an execution-context cleanup limitation for these observed teardown/port failures, without attributing historical registration 500 to it.

Failed termination now creates an ignored .pending-cleanup marker and blocks more tests until ownership/cleanup is verified. Safety refusal was validated without starting tests/servers. Each browser attempt owns unique output and HTML directories, preserving earlier artifacts. Full-browser command budget changed to 480s after the progressing 14-scenario attempt; individual test/assertion deadlines remain intact. Final full-browser/preview outcomes are in the ledger and matrix.

Final normal-permission verification: all 17 compiled-browser scenarios passed
in 378.58s; both production-preview smoke scenarios passed in 12.91s. Three
independent live runs each passed all 3 guarded journeys in 80.92s, 87.03s and
81.98s. Earlier interrupted attempts remain in the evidence ledger.

Docker CLI was absent on PATH/standard Windows location. WSL inventory found docker-desktop but its Docker wrapper rejected invocation. No Compose up, package/monitor installation, Docker reconfiguration or volume deletion occurred. Dependencies later recovered; WSL startup is a possible contributor, not a confirmed recovery cause.

## 12. CI Verification

Workflow: `.github/workflows/verification.yml`; read-only repository permission,
per-ref concurrency and bounded job time budgets. `fast` runs frontend typing/lint/
format/unit/build/bundle and backend lint/format/unit/build/API inventory.
`backend-integration` and `live-integration` each use fresh PostgreSQL 16 and Redis 7
services, a dedicated guarded test DB and reviewed migrations. Backend DB/HTTP/queue
suites remain sequential against one database. Separate frontend jobs run five
default attempts, three single-worker attempts, three guarded live attempts, compiled
browser and preview checks. Test commands and their watchdog budgets were preserved
while jobs were separated so their combined maximum budgets fit the job time limits.
Browser retries remain zero.

Synthetic database credentials exist only in this ephemeral CI service. Signing
keys are generated at runtime, never uploaded. Seven-day artifacts include summary
JSON and simulated/preview traces/screenshots; raw logs, authenticated live browser
captures, `.env`, database dumps and private report contents are excluded. Each
test job uploads its own artifact, including on failure.

Local YAML parser/trigger/job checks pass. This does not validate GitHub execution,
Linux browser dependencies or hosted service startup. **Hosted CI: NOT RUN.**
Jobs use independent hosts. After successful guarded preparation, backend suite
subchecks continue after an earlier test failure, retaining each outcome instead
of skipping later diagnostic groups. Local CI environment
validation passed fresh key/config generation, overwrite preservation, and
production/non-CI/remote/development/missing-target refusal checks. Generated
validation keys remain only in ignored private test artifacts.
Early inline validation failed due Windows native-argument quoting; the temporary
file-based validator initially misclassified YAML null trigger values, then passed
after checking property presence. Neither was a workflow defect.

### Running the hosted gate

The workflow runs for pull requests and `workflow_dispatch`; a feature-branch push
alone does not match its `push` filter, which currently covers `main`. To preserve
the existing worktree and prepare a feature branch, review status first, then use:

```powershell
git status --short
git switch -c ci/github-actions-verification
git add .github/workflows/verification.yml backend/README.md backend/scripts/diagnose-test-dependencies.js backend/scripts/prepare-ci-env.js docs/frontend-test-stability.md docs/production-readiness-remediation.md frontend/README.md frontend/e2e/live-server.mjs frontend/e2e/live/fixtures.ts frontend/e2e/live/workflows.spec.ts frontend/package.json frontend/playwright.config.ts frontend/playwright.live.config.ts frontend/scripts/verify-remediation.mjs frontend/scripts/windows-awake.mjs frontend/scripts/windows-awake.ps1 frontend/src/features/auth/AuthPages.test.tsx frontend/src/features/customers/CustomersPages.test.tsx frontend/src/features/dashboard/DashboardPage.test.tsx frontend/src/features/expenses/ExpensePages.test.tsx frontend/src/features/financials/FinancialPages.test.tsx frontend/src/features/invoices/InvoicePages.test.tsx frontend/src/features/payments/PaymentPages.test.tsx frontend/src/features/reports/ReportsPage.test.tsx frontend/src/organizations/CreateOrganizationPage.test.tsx frontend/src/test/api-context-lifecycle.test.ts frontend/src/test/api-context-lifecycle.ts frontend/src/test/worker-diagnostics.ts frontend/vitest.config.ts
git diff --cached --check
git diff --cached --stat
git commit -m "ci: prepare release verification workflow"
git push -u origin ci/github-actions-verification
```

Open a pull request from that branch to run the gate. Or, after pushing, choose
**Actions → Release verification → Run workflow** and select the feature branch.
Review the exact branch and commit shown in the run before treating its result as
evidence. The `gh` CLI is optional; it was not available in this local session.

### Reading failures and comparing hosts

- `fast` isolates install, typecheck, lint, format, frontend unit/build/bundle,
  backend unit/build/API inventory failures. It does not need PostgreSQL or Redis.
- `integration` step `prepare` covers the ephemeral services, generated Prisma
  client, generated test-only environment, guarded migration deployment and
  migration status. A failure here is infrastructure/configuration evidence;
  application suites are skipped unless preparation succeeds.
- `backend-db`, `backend-http` and `backend-queues` run sequentially because they
  share `sme_cashflow_test`. The following `default` and `single` modes are
  frontend repeatability checks; `live` exercises the API/worker against the
  guarded services; `browser` and `preview` exercise compiled-browser and preview
  flows respectively.
- Download `verification-evidence` for summary JSON and simulated/preview browser
  artifacts. It omits raw logs, authenticated live browser captures, `.env`,
  database dumps and report contents. Use the failing step and summary status/counts
  to locate the failure; do not infer details absent from these sanitized artifacts.

For a useful Windows comparison, run the same source commit with the documented
Node version and record the wrapper JSON's mode, status, duration, test counts,
event-loop/resource samples and whether the failure was an assertion or a
watchdog timeout. A hosted pass paired with a Windows timeout narrows the evidence
toward host scheduling, standby or local dependency conditions, but does not prove
which caused it. The same assertion failure on both hosts points toward a shared
test/code issue; a hosted timeout as well shows the problem is not limited to this
Windows machine. Compare only matching commits and test modes. Do not treat
historical counts or a different commit as a like-for-like run.

Hosted GitHub Actions has not executed for this workflow in this session. The
release gate therefore remains unverified until a hosted run completes on the
intended branch/commit.

## 13. Security and Tenant Isolation

Production controllers, DTO allowlists, current membership RBAC/tenant context, Decimal operations, composite FKs and audit/session transactions are unchanged. Fresh verification passes 308 unit tests, 134 PostgreSQL integration tests, 77 HTTP E2E tests and 8 Redis/queue tests, plus repeated real A/B live assertions.

No raw token, cookie, Authorization header, password, key, request body or exception text was added to diagnostics. CI generation rejects unsafe/production targets and refuses overwriting .env. Malformed URL errors are sanitized so native URL errors cannot echo input; a malformed-value redaction check passes. Raw backend/live logs, authenticated traces/screenshots, private files and .env are excluded from hosted artifacts. No development/production database cleanup occurred.

## 14. API and Backend Compatibility

Fresh inventory: **65 implemented / 65 documented routes**, PASS. Backend unit: **308 tests / 48 suites**, PASS. PostgreSQL integration: **134 / 15**, PASS. HTTP E2E: **77 / 14**, PASS. Redis/queues: **8 / 3**, PASS. All 3 migrations are current in guarded sme_cashflow_test; none were applied locally by this task.

Backend build passes with 223 JavaScript files. Route/controller/application/schema source is unchanged. Inventory checks metadata agreement; broad real HTTP/transaction/constraint/queue suites provide separate behavioral compatibility evidence.

## 15. Build and Bundle Verification

Fresh frontend production build and typecheck pass. Measured initial static graph:
**474.02 kB**, gzip sum **144.81 kB**. The historical 472.91 kB is not a controlled
before/after measurement for this task; no production frontend source changed.
Final frontend lint/format/typing and the two cleanup regression tests pass.
An initial lint run failed four findings in the new helper/ANSI parsing, then was
corrected without rule suppression: avoid React's special `use` callback name,
preserve primary errors outside `finally`, and use Node's ANSI stripping utility.

Fresh build and static initial-JS results are in the ledger; historical 472.91 kB
is not a substitute for running the bundle measurement again. No production
frontend component, bundling rule, dependency or financial calculation changed.

## 16. Release Gate Matrix

<!-- GATES -->

| Release gate | Evidence | Status |
| --- | --- | --- |
| Default frontend suite repeatability | 0/5 attempts passed; latest attempts reported 563/568, 566/568, 567/568 and 567/568 | **FAIL** |
| Single-worker frontend repeatability | 1 complete 568/568 pass in 288.94s; second run timed out at 502.98s with 532-test partial summary; third run not executed | **OPEN** |
| Frontend focused cleanup regressions | 2/2 new disposal regressions pass; Dashboard preload no longer times out, though other suites still fail intermittently | **PASS** (focused gate only) |
| Registration HTTP behavior | Guarded auth suite 8/8 and three live registration journeys pass; historical 500 cause unresolved | **OPEN** |
| Tenant-scoped service reads | Three live runs cover read paths with no unexpected 5xx; historical expense read 5xx cause unresolved | **OPEN** |
| Backend unit / PostgreSQL / HTTP / queue suites | 308/308, 134/134, 77/77, 8/8 pass | **PASS** |
| API inventory and compatibility | 65 implemented / 65 documented; 3 guarded migrations current | **PASS** |
| Live financial/browser workflows | 3/3 journeys passed in each of 3 independent runs; retains earlier teardown timeout | **PASS** (final repetitions) |
| Compiled browser and preview | 17/17 and 2/2 passed in final full runs; retains earlier timeout/port collision | **PASS** (final runs) |
| Frontend production build, typing, lint, format, bundle | Build/type/lint/format pass; initial static graph 474.02 kB, gzip sum 144.81 kB | **PASS** |
| Backend build, lint, format | 223 JavaScript files compiled; final lint and format checks pass | **PASS** |
| Hosted CI execution | Workflow parsed and local safety checks passed; GitHub hosted jobs not run | **OPEN** |
| Production/staging, security operations, accessibility | No staging target supplied; deployment configuration and manual accessibility review remain | **OPEN** |

Overall release gate: **NOT READY FOR PRODUCTION DEPLOYMENT**. Positive final
subsuite results do not override the failed repeatability gate or unresolved
historical 5xx diagnosis.
<!-- /GATES -->

## 17. Remaining Issues

- **HIGH:** default suite repeatability fails and single-worker timeout remains; historical multi-hour anomaly is unconfirmed. Release blocked by repeatability.
- **HIGH:** historical registration/service-read 5xx root cause remains unconfirmed despite fresh positive guarded repetitions. No claimed production fix is justified.
- **MEDIUM:** hosted CI and deployed HTTPS/cookie/CORS/shared-storage verification not run.
- **MEDIUM:** manual screen reader, physical zoom/reflow, touch and focus review incomplete.
- **LOW:** wall-clock session expiry, independent cross-tab rotation and scheduled reminders not newly exercised.
- **INFORMATIONAL:** local restricted Windows cleanup required approved ownership inspection/termination; marker blocks unsafe continuation. Synthetic data/artifacts remain governed by test-only maintenance. No production data was touched.

## 18. Production/Staging Prerequisites

No authorized staging environment or credentials were provided. Before release:

- Approved HTTPS frontend/API origins; Secure/HttpOnly host-only refresh cookie
  and existing SameSite=Lax behavior; credentialed allowlisted CORS.
- Correct build-time public `VITE_API_BASE_URL`; no secrets in Vite settings.
- Separately supervised API/worker; protected PostgreSQL/Redis and reviewed
  migrations; readiness, error/latency, DB/queue-lag monitoring.
- Private durable shared API/worker report storage, authorized downloads,
  checksum/size/expiry checks and an operational artifact retention policy.
- Unique managed signing keys and infrastructure credentials; database grants,
  backups and an exercised recovery procedure.
- SPA deep-link fallback, correct asset MIME types, immutable asset caching and
  suitable HTML cache policy.
- Guarded authenticated repeatability, staging A/B isolation, financial flows,
  worker CSV generation/download, session lifecycle and manual accessibility.

## 19. Verification Commands

Commands, timestamps, results and durations are in section 4. Reproduce from
`frontend/` with `node scripts/verify-remediation.mjs <plan> [1-5]`.
Plans run each application's own npm commands in that application's directory.
Use `default 5`, `single 3`, `live 3`, `browser`, `preview`, `backend-unit`,
`backend-db`, `backend-http`, `backend-queues`, `auth-http`, `auth-db`, `inventory`,
`migrations`, `dependencies`, `typecheck`, `lint`, `format`, `build`, `size`,
`backend-build`, `backend-lint`, `backend-format` as appropriate.

Auxiliary checks: scoped process inspection was denied in sandbox and passed after
approval; WSL inventory behaved similarly. The first dependency-wrapper attempt
used `npm exec node`, which tried package resolution and encountered npm-cache
EACCES/command timeout. It was corrected to direct Node execution; no dependency
was installed. The original failed artifact remains in the ledger. Initial and
final `git diff --check` and `git status --short` are recorded separately.

## 20. Git Status

<!-- GIT -->

Final `git status --short`:

```text
 M backend/README.md
 M frontend/README.md
 M frontend/e2e/live-server.mjs
 M frontend/e2e/live/workflows.spec.ts
 M frontend/playwright.config.ts
 M frontend/playwright.live.config.ts
 M frontend/src/features/dashboard/DashboardPage.test.tsx
?? .github/
?? backend/scripts/diagnose-test-dependencies.js
?? backend/scripts/prepare-ci-env.js
?? docs/production-readiness-remediation.md
?? frontend/e2e/live/fixtures.ts
?? frontend/scripts/verify-remediation.mjs
?? frontend/src/test/api-context-lifecycle.test.ts
?? frontend/src/test/api-context-lifecycle.ts
```

`git diff --check`: PASS. The ignored cleanup marker is absent. No files were
staged or committed.
<!-- /GIT -->

## 21. Final Release Verdict

**NOT READY FOR PRODUCTION DEPLOYMENT**

The historical service 5xx diagnosis remains open, repeated frontend verification
has demonstrated failures, and hosted CI/staging are unexecuted. Minimal test
lifecycle improvements and repeatable evidence/CI infrastructure do not establish
production readiness. No unverified target is converted to PASS.

## 22. Scope Confirmation

No new product feature, redesign, backend API, schema, migration, financial rule,
production retry or tenant/auth authority change. Original frontend tests and
existing history are retained. Existing uncommitted work was absent at start;
ignored/user files were preserved. No commit or unauthorized deployment. Remaining
checks and operational prerequisites are explicit. Architecture deviation: none;
documentation correction: current baseline is 566/28 rather than historical 548/27.
