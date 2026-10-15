# Focused frontend test stability remediation

Verification date: 2026-10-14 (Asia/Calcutta). Evidence timestamps use UTC.
Windows, Node v24.18.0, Vitest v5.0.3, jsdom v30.1.2; 568 original tests in
29 suites. This is a local assessment; nothing was committed or deployed.

## Scope and repository inspection

Read AGENTS.md, repository blueprint, frontend production readiness, production
readiness remediation, frontend package/configuration, test setup/helpers,
Dashboard and failed page suites, and the existing bounded verification script.
Read prior ignored logs before starting new tests. Preserved all initial changes.
No product source, backend business logic, authentication contract, financial
rule, database schema, API or dependency version was changed.

The starting 527 backend passes, 65 APIs, 17 browser scenarios, two preview
scenarios and three independently repeated live journeys are prior verified
evidence, not newly executed backend results in this task.

## Exact previously failed suites

Paths below are relative to `frontend/src/`. Full assertion names, error stacks
and DOM snapshots remain in the linked original logs.

| Prior attempt (UTC)                                                                                   | Failed suites and observations                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [04:57:36 focused](../frontend/test-results/remediation/2026-10-14T04-57-36-853Z-focused-1.log)       | `features/dashboard/DashboardPage.test.tsx`: 10-second `beforeAll` dynamic import timeout; 17 runner-skipped tests.                                                                                                                                                                                                                                              |
| [05:03:07 default](../frontend/test-results/remediation/2026-10-14T05-03-07-578Z-default-1.log)       | `features/reports/ReportsPage.test.tsx`: CASH_FLOW export status not found. 565/566 passed before the two earlier cleanup regressions were added.                                                                                                                                                                                                                |
| [05:10:03 regression](../frontend/test-results/remediation/2026-10-14T05-10-03-816Z-regression-1.log) | Dashboard and Reports: 10 failures involving initial rendering, presets/custom ranges, denial and export creation/download.                                                                                                                                                                                                                                      |
| [05:21:15 single](../frontend/test-results/remediation/2026-10-14T05-21-15-853Z-single-2.log)         | `features/customers/CustomersPages.test.tsx`, `features/expenses/ExpensePages.test.tsx`, `features/notifications/NotificationsPage.test.tsx`: 10 failures. Fork workers failed to start for `features/auth/AuthPages.test.tsx` and `organizations/Workspace.test.tsx`; explicitly reported "Timeout waiting for worker to respond". Incomplete 532-test summary. |
| [05:32:41 default](../frontend/test-results/remediation/2026-10-14T05-32-41-184Z-default-1.log)       | Customers: archive timeout; `features/invoices/InvoicePages.test.tsx`: debounce/pagination timeout; Expenses: stale void control missing; `features/payments/PaymentPages.test.tsx`: reloaded payment amount missing; Notifications: cursor/filter timeout. 563/568 passed.                                                                                      |
| [05:37:13 default](../frontend/test-results/remediation/2026-10-14T05-37-13-430Z-default-2.log)       | Invoices: cancel control missing; Customers: initial directory missing. 566/568 passed.                                                                                                                                                                                                                                                                          |
| [05:40:10 default](../frontend/test-results/remediation/2026-10-14T05-40-10-894Z-default-3.log)       | Expenses: void control missing while DOM still showed "Checking your session". 567/568 passed.                                                                                                                                                                                                                                                                   |
| [05:42:41 default](../frontend/test-results/remediation/2026-10-14T05-42-41-428Z-default-4.log)       | Reports: selected CSV download control missing. 567/568 passed.                                                                                                                                                                                                                                                                                                  |

Thus the five old full default attempts failed across six page suites: Reports,
Customers, Invoices, Expenses, Payments and Notifications. Dashboard failed in
the focused/regression runs. Auth and Workspace additionally had worker startup
errors in the old single-worker attempt; these were not assertion failures.

## Fresh reproduction and confirmed findings

- [11:18:17 baseline log](../frontend/test-results/remediation/2026-10-14T11-18-17-941Z-default-1.log)
  reproduced Invoices' initial directory failure and Expenses' literal-filter
  timeout and archived/voided-history table failure. It produced no final test
  summary. Its [metadata](../frontend/test-results/remediation/2026-10-14T11-18-17-941Z-default-1.json)
  records TIMEOUT after 448.637 wall seconds against a 300-second budget and
  **218,238.026 ms parent event-loop delay**. A nominal one-second tool poll also
  returned after roughly 220 seconds during this period. This is a fresh large
  scheduling/tool anomaly, not proof of the historical multi-hour cause.
- [11:26:56 isolated Reports](../frontend/test-results/remediation/2026-10-14T11-26-56-632Z-reports-1.json)
  passed 36/36 in 12.533 seconds, before the new page setup changes. Reports'
  prior failure did not reproduce independently in this attempt.
- [11:27:43 thread comparison](../frontend/test-results/remediation/2026-10-14T11-27-43-420Z-threads-1.json)
  timed out at 300.431 seconds. All 29 per-file diagnostic records were eventually
  present, but no final runner summary was captured. Those records are not
  substitutes for test pass results. Threads are not adopted.
- [11:46:50 final-source default](../frontend/test-results/remediation/2026-10-14T11-46-50-928Z-default-2.log)
  completed with 558/568 passed and ten failures: Expenses (category switch,
  membership revocation, mutation 401, management permission loss); Payments
  (initial history, cursors/filters); Invoices (mutation 401 timeout, field
  validation, payment-history blocker, invalid cursor/date range). The Invoice
  worker recorded 10,317.988 ms event-loop delay and Expenses 7,268.729 ms,
  exceeding the five-second test deadline. Static preloads did not solve this.
- [11:50:38 final-source default](../frontend/test-results/remediation/2026-10-14T11-50-38-410Z-default-3.json)
  timed out after 559.533 seconds; tree termination returned zero. Only 64
  one-second resource samples were recorded. Its 329.253 ms histogram maximum
  does not explain the missing sampling time: a delayed histogram callback can
  be discarded when monitoring is disabled during termination. Exact watchdog
  firing/termination times and explicit sample gaps were added for later runs.
- The earlier Dashboard hook timeout is confirmed by its original stack. Its
  existing static preload was preserved. Four other suites still used timed
  `beforeAll` imports; those imports have been moved to test-module evaluation.
  This removes that hook deadline boundary without changing hook/test deadlines.
- Code inspection confirmed that Customers and Invoices deferred MSW gates were
  released only on successful assertion paths. Their teardown now unmounts,
  disposes the router/cache and releases every gate even when an assertion fails.
  This is a cleanup defect; it is **not proven to explain the historical failures**.

**Confirmed root cause of the fresh long command overruns: Windows Modern
Standby during unattended verification.** The retained
[Windows event evidence](../frontend/test-results/remediation/windows-standby-events.json)
contains Kernel-Power 506/507 entries with entry reason "Idle Timeout" and
resume events aligning with the delayed watchdogs:

| Enter standby (UTC) | Resume (UTC) | Corresponding observation                                                                                                                                                       |
| ------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11:21:54.035        | 11:25:46.131 | Baseline finishes at 11:25:46.578; 218-second parent delay.                                                                                                                     |
| 11:51:38.578        | 11:59:54.469 | Two-worker batch timeout finishes at 11:59:57.943, after 559.533 seconds.                                                                                                       |
| 14:01:15.785        | 14:02:16.477 | Passing Windows serial run records a 32.163-second sampling gap.                                                                                                                |
| 14:08:27.062        | 14:24:05.557 | Windows serial run finishes at 14:24:07.542; watchdog fires at elapsed 956.540 seconds and termination takes only 2.321 seconds. Parent delay/sample gap are about 920 seconds. |

The fourth serial default attempt therefore demonstrates late watchdog
scheduling, rather than a 15-minute termination operation. Its
[metadata](../frontend/test-results/remediation/2026-10-14T14-08-08-678Z-default-4.json)
retains every measurement. These interruptions invalidate awake-host runtime
comparisons. No application promise deadlock was demonstrated by them.

Not all DOM failures are explained by standby: the serial third attempt
completed while awake with three Payments table failures and a 1.785-second
worker delay. Those tests started a one-second table wait across both application
bootstrap and the later payment-query phase. They now first await the real
Payments heading, then retain their original table and financial assertions.
This separates the observable UI phases without increasing any deadline.

Worker startup timeouts are confirmed historical symptoms. Available-memory
pressure, compilation/GC cost and worker scheduling remain supported contributors
to shorter deadline sensitivity; specific paging/antivirus causes are unproven.
The historical multi-hour anomaly was not retrospectively attributed to standby.
Wall and monotonic clocks agree closely in captured attempts; a wall-clock jump
was not demonstrated.

## Isolation and asynchronous behavior review

| Area                   | Evidence and decision                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MSW                    | Each isolated suite uses listen with unhandled requests treated as errors, handler reset after each test and close after the suite. Handler leakage was not demonstrated. Unreleased failure-path gates in Customers/Invoices were repaired.                                  |
| QueryClient            | Page mounts construct fresh clients and dispose their own routers/caches. Session tests track and clear clients; direct query tests use `finally`. No shared tenant cache leak was demonstrated. Production retry policy and GC behavior remain unchanged.                    |
| Fake timers            | CSV download tests are the only fake-timer users; their `afterEach` restores real timers, globals and mocks. No fake-timer leakage demonstrated. No new fake timers added.                                                                                                    |
| RTL                    | Shared cleanup exists; affected teardown explicitly unmounts before cache/router disposal. Assertions and StrictMode coverage are retained.                                                                                                                                   |
| Pending promises       | Request gates exercise cancellation and delayed replies. Customers/Invoices lacked unconditional release; other page suites already track/release gates. No proof that a still-pending business query caused host suspension.                                                 |
| Lazy routes            | Cold transformations were inside hook or short DOM deadlines. Page test preloads now assign dependency loading to module evaluation; actual lazy router functions and all behavioral assertions remain exercised. Cold compiled-browser route loading is verified separately. |
| Dashboard              | Existing static preload avoids the former `beforeAll` import deadline. Router completion helper remains intact. Its actual session/data/rendering can still be delayed by the host; setup cannot guarantee scheduling.                                                        |
| Parallel-only failures | Not established: the old single-worker run also had assertion and worker startup failures. Pool comparison does not support changing the default to threads.                                                                                                                  |

## Changes and files owned by this task

- `frontend/src/features/auth/AuthPages.test.tsx`: preload authentication views.
- `frontend/src/features/customers/CustomersPages.test.tsx`: preload views and
  unconditional deferred-gate release after unmount/disposal.
- `frontend/src/features/invoices/InvoicePages.test.tsx`: static preload replaces
  timed import; unconditional gate release after unmount/disposal.
- `frontend/src/features/expenses/ExpensePages.test.tsx`: static page/category preloads.
- `frontend/src/features/financials/FinancialPages.test.tsx`: static financial/aging preloads.
- `frontend/src/features/payments/PaymentPages.test.tsx`: static payment/invoice
  preloads and explicit page-heading readiness before the three affected initial
  history-table waits; original table/financial assertions retained.
- `frontend/src/features/reports/ReportsPage.test.tsx`: static reports/audit preloads.
- `frontend/src/organizations/CreateOrganizationPage.test.tsx`: static creation-page preload.
- `frontend/src/test/worker-diagnostics.ts`: opt-in worker clocks, CPU, memory and
  event-loop observations. Does not change assertions, timers, retries or mocks.
- `frontend/vitest.config.ts`: loads diagnostics only when the evidence runner
  supplies `TEST_STABILITY_DIAGNOSTICS`. Windows defaults to one fork after three
  complete serial passes contrasted with two-worker failures. Other platforms
  retain two workers. Fork pool and per-file isolation are explicit; jsdom and
  deadlines are preserved. CLI worker overrides remain available for diagnosis.
- `frontend/scripts/verify-remediation.mjs`: narrow diagnostic/focused plans,
  opt-in worker observation and one-second available-memory samples, retained
  alongside the existing unique log/JSON and bounded process-tree watchdog.
  Later records also capture maximum resource-sampling gap, watchdog firing
  time and termination duration; existing earlier evidence is not rewritten.
  Plan worker metadata follows the same Windows/non-Windows policy.
- `frontend/scripts/windows-awake.mjs` and `windows-awake.ps1`: a hidden, owned
  Windows helper acquires a temporary system/display execution request and holds
  it only while the bounded runner owns stdin. Completion or owner exit closes
  stdin; the helper clears its request in `finally`. Startup and release are
  bounded, helper liveness is checked, and release evidence is retained. No
  persistent power-plan or execution-policy change, away mode or simulated input.
- `frontend/package.json`: `test:stability` and `test:stability:single` expose
  the bounded five-default/three-single verification commands; no dependency change.
- `frontend/README.md`: append current verification commands and awake-context caveat.
- `docs/frontend-test-stability.md`: this report.

No tests were removed, skipped, retried or weakened. No arbitrary sleeps or
global timeout increases were introduced. Existing sleeps in old tests were not
expanded. No architectural deviations or API/document-contract corrections.

The awake helper uses `SetThreadExecutionState` with continuous system/display
requirements and clears them at release. This is the documented temporary API;
it does not prevent explicit user sleep/lid actions. Ordinary `npm run test`
does not hold this request; use the bounded stability commands for unattended
measurement. See [Microsoft's API documentation](https://learn.microsoft.com/en-us/windows/desktop/api/winbase/nf-winbase-setthreadexecutionstate).

The compiled-browser command budget changed from 480 to 900 seconds after the
480-second attempt completed only eight of 17 scenarios, all passing, with
individual reflow/accessibility scenarios taking 32–78 seconds. This is one
bounded full-scenario command envelope; no Playwright test/assertion deadline,
retry or scenario count changed. Frontend full-suite command budgets remain 300 seconds.

## Worker and resource observations

The host reports an Intel i3-1215U, eight logical processors and 8,065,780 KiB
visible memory. After baseline timeout it had 752,712 KiB free (about 735 MiB).
A later CPU snapshot showed 46% load. Desktop applications, editors and security
software were also resident; these were not closed or altered. Resource sampling
is observational, not a controlled host experiment.

Isolated Reports' worker max event-loop delay was 225.575 ms and its RSS ended at
334,426,112 bytes. The thread experiment's FinancialPages worker recorded
5,129.634 ms delay. A transition default pass reached only 471,203,840 bytes free
memory (about 449 MiB); low memory alone therefore does not predict failure.

Worker diagnostics begin when the diagnostic setup module evaluates, before
test-module imports; `setupSeconds` includes subsequent setup/import work, not
the earlier process/thread launch. Worker histogram values observe those event
loops; the original parent monitor observes only the runner's event loop.
Thread-pool CPU/RSS counters are process-level aggregates and cannot be attributed
to an individual thread. One-second free-memory sampling can miss shorter dips
and stops during a parent stall. Neither counters nor startup errors identify a
specific Windows suspension mechanism.

Both initial sandbox timeout terminations returned exit 1. Scoped inspection
confirmed their Node processes had exited before removing each cleanup marker;
only the unrelated pre-existing Node PID 11128 remained. Subsequent bounded runs
use outside-sandbox execution so the watchdog can terminate its own tree.

## Verification ledger and release gate

All commands ran from `frontend/`. The wrapper invocation is
`node scripts/verify-remediation.mjs <plan> <repetitions>`; the exact child commands
are listed below and in each JSON. Logs use the same basename as their JSON.
The five-attempt default batch stopped after its third attempt timed out;
attempts four and five were not started. Its first attempt is a transition run:
the Customers/Invoices unconditional gate-release changes were applied after
those modules may already have loaded. It is not counted as final-source repeatability.
The original three-attempt single batch was interrupted during attempt one;
attempts two and three were not started. Its interruption sidecar preserves
the missing-result distinction. A later complete pass justified two remaining
bounded single-worker measurements. Tests were not run indefinitely.

| Plan / child command                                                                 | Evidence (UTC start)                                                                                              | Outcome                                                                |         Wall seconds |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------: |
| Baseline `default 1`: `npm.cmd run test`                                             | [11:18:17](../frontend/test-results/remediation/2026-10-14T11-18-17-941Z-default-1.json)                          | TIMEOUT; partial Invoices/Expenses failures; no final counts           |              448.637 |
| `reports 1`: `npm.cmd run test -- src/features/reports/ReportsPage.test.tsx`         | [11:26:56](../frontend/test-results/remediation/2026-10-14T11-26-56-632Z-reports-1.json)                          | PASS 36/36, one suite                                                  |               12.533 |
| `threads 1`: `npm.cmd run test -- --pool=threads`                                    | [11:27:43](../frontend/test-results/remediation/2026-10-14T11-27-43-420Z-threads-1.json)                          | TIMEOUT; no final counts                                               |              300.431 |
| `default 5`, transition attempt 1: `npm.cmd run test`                                | [11:44:50](../frontend/test-results/remediation/2026-10-14T11-44-50-403Z-default-1.json)                          | PASS 568/568, 29 suites                                                |              120.516 |
| `default 5`, final-source attempt 2: `npm.cmd run test`                              | [11:46:50](../frontend/test-results/remediation/2026-10-14T11-46-50-928Z-default-2.json)                          | FAIL 558 passed / 10 failed; three failed suites                       |              227.478 |
| `default 5`, final-source attempt 3: `npm.cmd run test`                              | [11:50:38](../frontend/test-results/remediation/2026-10-14T11-50-38-410Z-default-3.json)                          | TIMEOUT; no final counts; termination exit 0                           |              559.533 |
| `single 3`, interrupted attempt 1: `npm.cmd run test -- --pool=forks --maxWorkers=1` | [12:01:08 interruption](../frontend/test-results/remediation/2026-10-14T12-01-08-678Z-single-1.interruption.json) | INTERRUPTED; tool call aborted, session then unknown; no final summary |              Unknown |
| `npm.cmd run typecheck`                                                              | Terminal command exited 0; build also runs `tsc --noEmit`                                                         | PASS                                                                   | Not timed separately |
| `lint 1`: `npm.cmd run lint`                                                         | [12:13:26](../frontend/test-results/remediation/2026-10-14T12-13-26-194Z-lint-1.json)                             | PASS                                                                   |               82.908 |
| `format 1`: `npm.cmd run format:check`                                               | [12:14:49](../frontend/test-results/remediation/2026-10-14T12-14-49-299Z-format-1.json)                           | PASS                                                                   |               13.050 |
| `build 1`: `npm.cmd run build`                                                       | [12:15:02](../frontend/test-results/remediation/2026-10-14T12-15-02-496Z-build-1.json)                            | PASS, TypeScript and production Vite output                            |               32.562 |
| `invoices 1`: `npm.cmd run test -- src/features/invoices/InvoicePages.test.tsx`      | [13:13:24](../frontend/test-results/remediation/2026-10-14T13-13-24-897Z-invoices-1.json)                         | PASS 27/27, one suite                                                  |               22.252 |
| `expenses 1`: `npm.cmd run test -- src/features/expenses/ExpensePages.test.tsx`      | [13:13:47](../frontend/test-results/remediation/2026-10-14T13-13-47-234Z-expenses-1.json)                         | PASS 41/41, one suite                                                  |               14.272 |
| `dashboard 1`: `npm.cmd run test -- src/features/dashboard/DashboardPage.test.tsx`   | [13:14:01](../frontend/test-results/remediation/2026-10-14T13-14-01-579Z-dashboard-1.json)                        | PASS 17/17, one suite                                                  |                8.411 |
| `single 1`: `npm.cmd run test -- --pool=forks --maxWorkers=1`                        | [13:14:36](../frontend/test-results/remediation/2026-10-14T13-14-36-347Z-single-1.json)                           | PASS 568/568, 29 suites; zero skipped                                  |              136.491 |
| `single 2`, attempt 1: same explicit single-worker command                           | [13:19:04](../frontend/test-results/remediation/2026-10-14T13-19-04-951Z-single-1.json)                           | PASS 568/568, 29 suites; zero skipped                                  |              178.912 |
| `single 2`, attempt 2: same explicit single-worker command                           | [13:22:03](../frontend/test-results/remediation/2026-10-14T13-22-03-872Z-single-2.json)                           | PASS 568/568, 29 suites; zero skipped                                  |              160.582 |

Invoices and Expenses did not reproduce their failures independently after the
setup changes. Together with independent Reports and Dashboard passes, this
supports full-suite contention as a contributor, but does not prove exclusivity
or causality. Final isolated max worker delays: Invoices 847.774 ms, Expenses
232.653 ms, Dashboard 667.943 ms. The full-run 7–10-second worker delays remain
unexplained at the OS/application level.

The evidence runner previously counted a Vite "modules transformed" checkmark
as a browser pass in build metadata. Counting browser progress is now restricted
to browser plans. The earlier build record is retained; its `counts.passed: 1`
is not a test result. Build success is its exit code and actual compiler output.

Three consecutive complete explicit single-worker runs passed after the earlier
interruption; all use the final test bodies and the same effective one-fork
configuration as the subsequent Windows default. This justified changing only
the Windows default worker cap and performing **one additional five-attempt
default batch**, still with a 300-second per-command budget and stop-on-timeout.
No test/assertion/hook deadline, isolation setting or retry policy was relaxed.
The default-worker cap is a resource mitigation supported by those serial
results, not proof of the exact underlying Windows scheduling mechanism.

The last serial run reported 29 isolated workers spawned, about 945 ms startup
each (spawn plus environment). Isolation was retained rather than reusing a
shared worker environment across files. Earlier logs separately demonstrate
actual fork startup timeouts. Linux/default two-worker reliability is not
measured by the Windows serial results.

The Windows default was then capped at one fork, Payments received the explicit
phase-readiness waits, and the stability runner acquired the temporary awake
request. The evidence runner was asked for five default attempts and three
single-worker attempts, stopping each batch on a timeout. Results from this
final-source batch are:

| Plan / child command                                                             | Evidence (UTC start)                                                                     | Outcome                                                            | Wall seconds |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -----------: |
| `default 5`, guarded attempt 1: `npm.cmd run test`                               | [15:50:54](../frontend/test-results/remediation/2026-10-14T15-50-54-078Z-default-1.json) | PASS 568/568, 29 suites                                            |      221.230 |
| `default 5`, guarded attempt 2: `npm.cmd run test`                               | [15:54:35](../frontend/test-results/remediation/2026-10-14T15-54-35-317Z-default-2.json) | PASS 568/568, 29 suites                                            |      215.194 |
| `default 5`, guarded attempt 3: `npm.cmd run test`                               | [15:58:10](../frontend/test-results/remediation/2026-10-14T15-58-10-515Z-default-3.json) | PASS 568/568, 29 suites                                            |      235.558 |
| `default 5`, guarded attempt 4: `npm.cmd run test`                               | [16:02:06](../frontend/test-results/remediation/2026-10-14T16-02-06-075Z-default-4.json) | PASS 568/568, 29 suites                                            |      225.560 |
| `default 5`, guarded attempt 5: `npm.cmd run test`                               | [16:05:51](../frontend/test-results/remediation/2026-10-14T16-05-51-647Z-default-5.json) | TIMEOUT at 300 sec; no final summary, 28/29 suite teardown records |      300.971 |
| `single 3`, guarded attempt 1: `npm.cmd run test -- --pool=forks --maxWorkers=1` | [16:10:55](../frontend/test-results/remediation/2026-10-14T16-10-55-126Z-single-1.json)  | PASS 568/568, 29 suites                                            |      223.773 |
| `single 3`, guarded attempt 2: same explicit single-worker command               | [16:14:38](../frontend/test-results/remediation/2026-10-14T16-14-38-906Z-single-2.json)  | TIMEOUT at 300 sec; no final summary, nine suite teardown records  |      300.603 |

The fifth default attempt had continuous parent progress: maximum parent event-loop
delay was 269 ms and the largest resource sampling gap was 1.512 seconds. The
awake helper was confirmed active and released successfully after exit. The
runner killed the owned process tree in 0.905 seconds. It had 28 suite teardown
records, with `src/lib/env.test.ts` missing, and no final Vitest counts. This is
a genuine bounded-run timeout, but the available evidence does not identify an
application-level hang or a specific blocked test. It is not counted as a pass.

The second single-worker attempt also had an active/released awake helper,
continuous parent progress (371 ms maximum delay; 1.197-second maximum sample
gap) and quick process-tree termination. Available memory fell to 17,399,808
bytes (about 16.6 MiB) during the run; only nine suite teardown records were
captured and no runner summary was produced. Severe resource pressure is
confirmed for this attempt, but it does not alone prove why progress stopped.
The third single-worker attempt was not started after the timeout. Thus the
requested repeatability target was **not met**: final-source default achieved
four consecutive complete passes followed by a timeout, and final-source
single-worker achieved one pass followed by a timeout. Earlier complete passes
remain in the ledger but do not count as the final-source sequence.

The final standalone checks were run after the last source change:

| Command                                           | Evidence                                                                                      | Outcome                                                                                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/verify-remediation.mjs typecheck 1` | [16:19:41](../frontend/test-results/remediation/2026-10-14T16-19-41-296Z-typecheck-1.json)    | PASS                                                                                                                                                                                                       |
| `node scripts/verify-remediation.mjs lint 1`      | [16:20:55](../frontend/test-results/remediation/2026-10-14T16-20-55-572Z-lint-1.json)         | FAIL: ESLint `preserve-caught-error` flagged the new cleanup `AggregateError` without a `cause`; fixed by preserving `cause`                                                                               |
| `npm.cmd run lint`                                | Direct rerun after the fix                                                                    | PASS, exit 0. The wrapper retry itself could not start because this machine's PowerShell execution policy rejected its `.ps1` helper. A focused ESLint run over all three helper/config files also passed. |
| `node scripts/verify-remediation.mjs format 1`    | [16:22:08](../frontend/test-results/remediation/2026-10-14T16-22-08-966Z-format-1.json)       | PASS                                                                                                                                                                                                       |
| `node scripts/verify-remediation.mjs build 1`     | [16:22:26](../frontend/test-results/remediation/2026-10-14T16-22-26-219Z-build-1.json)        | PASS: TypeScript and production Vite build                                                                                                                                                                 |
| `node scripts/verify-remediation.mjs browser 1`   | [16:23:30](../frontend/test-results/remediation/2026-10-14T16-23-30-740Z-browser-1.json)      | PASS: 17/17 compiled-browser scenarios, 506.612 seconds                                                                                                                                                    |
| `preview 1`                                       | [15:27:50](../frontend/test-results/remediation/2026-10-14T15-27-50-391Z-preview-1.json)      | PASS: 2/2 production-preview scenarios                                                                                                                                                                     |
| `live 1`                                          | [15:28:26](../frontend/test-results/remediation/2026-10-14T15-28-26-032Z-live-1.json)         | BLOCKED before journeys: guarded PostgreSQL/Redis initialization failed. No live scenario ran.                                                                                                             |
| focused `payments 1`                              | [15:37:13](../frontend/test-results/remediation/2026-10-14T15-37-13-015Z-payments-1.json)     | PASS: 37/37                                                                                                                                                                                                |
| dependency availability probe                     | [15:37:10](../frontend/test-results/remediation/2026-10-14T15-37-10-948Z-dependencies-1.json) | Guarded test PostgreSQL and Redis connections were refused; no database mutation attempted                                                                                                                 |

The prior 527 backend test passes, 65 API count and three guarded live journeys
in each of three runs remain the production-readiness report's evidence. They
were not re-run here. Current browser and preview checks pass; current live
journeys remain unverified because their guarded local services were unavailable.

## Release gate status

**NOT PASSED - repeatability gate remains open.** Four full default runs passed
in a row, but attempt five timed out. One complete final-source single-worker
run passed, then its next attempt timed out; the third was correctly withheld
after the bounded failure. The local Windows host produced repeated standby
interruptions before the awake guard was introduced, and severe available-memory
pressure during the later serial timeout. The final default timeout happened
while parent progress and memory sampling continued normally. The evidence
establishes instability under the bounded local Windows conditions, but does not
show that the residual timeout is a product defect or prove that it is solely an
environmental defect.

All 568 original tests remain enabled. No assertion, retry, isolation or test
deadline was weakened. TypeScript, full lint, formatting, production build,
compiled-browser and preview checks passed. The repeatability gate requires five
consecutive default passes and three complete single-worker passes, so it remains
open despite those checks. The local guarded database services prevented a new
live run. A non-Windows/two-worker CI comparison and a stable-resource Windows
rerun are still unavailable; the historical multi-hour discontinuity is not
retrospectively explained. The awake request prevents idle timeout observed in
this session, while explicit sleep/lid actions and external host resource
contention remain outside the helper's control.

## Git status

Initial `git status --short`:

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

All of these were preserved; the evidence runner was intentionally extended.
Ignored logs, JSON and worker diagnostics remain in `frontend/test-results/remediation/`.

Final `git status --short` after this work:

```text
 M backend/README.md
 M frontend/README.md
 M frontend/e2e/live-server.mjs
 M frontend/e2e/live/workflows.spec.ts
 M frontend/package.json
 M frontend/playwright.config.ts
 M frontend/playwright.live.config.ts
 M frontend/src/features/auth/AuthPages.test.tsx
 M frontend/src/features/customers/CustomersPages.test.tsx
 M frontend/src/features/dashboard/DashboardPage.test.tsx
 M frontend/src/features/expenses/ExpensePages.test.tsx
 M frontend/src/features/financials/FinancialPages.test.tsx
 M frontend/src/features/invoices/InvoicePages.test.tsx
 M frontend/src/features/payments/PaymentPages.test.tsx
 M frontend/src/features/reports/ReportsPage.test.tsx
 M frontend/src/organizations/CreateOrganizationPage.test.tsx
 M frontend/vitest.config.ts
?? .github/
?? backend/scripts/diagnose-test-dependencies.js
?? backend/scripts/prepare-ci-env.js
?? docs/frontend-test-stability.md
?? docs/production-readiness-remediation.md
?? frontend/e2e/live/fixtures.ts
?? frontend/scripts/verify-remediation.mjs
?? frontend/scripts/windows-awake.mjs
?? frontend/scripts/windows-awake.ps1
?? frontend/src/test/api-context-lifecycle.test.ts
?? frontend/src/test/api-context-lifecycle.ts
?? frontend/src/test/worker-diagnostics.ts
```
