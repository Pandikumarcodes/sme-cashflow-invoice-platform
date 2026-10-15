# Frontend consolidated verification

Verification date: 2026-10-15 (Asia/Calcutta).

This milestone stabilizes the existing Stage 1–3 frontend work. It does not add application behavior. Commands below ran from `frontend/` unless stated otherwise. Existing uncommitted work was preserved.

## Status key

- **PASS**: the cited check completed successfully.
- **FAIL**: a completed check produced a failing assertion or command result.
- **BLOCKED**: the check did not produce a complete result within the established Windows time budget.
- **NOT RUN**: the check was deliberately not executed in this continuation.

## App not-found failures

**PASS — reproduced and corrected.** The two original failures were the parameterized `renders a safe not-found route` cases for `/404` and `/missing/deep/path` in `frontend/src/app/App.test.tsx`. The focused reproduction completed with 2 passed and 2 failed. Both failures raised `Authentication requires the application provider` from `FoundationLayout`.

The root cause was the test harness. These routes render `FoundationLayout`, which uses `useAuth`, while the tests mounted `RouterProvider` by itself. React Router therefore rendered its safe route error state before the not-found page could render. Production authentication and route behavior were not defective.

The tests now use the application provider composition: `ErrorBoundary`, a real test `QueryClientProvider`, `AuthProvider` with `createSession`, and `RouterProvider`. They retain assertions for the not-found heading and workspace return navigation, and now also assert that public sign-in navigation resolves to `/login`. The router and query client are disposed after each parameterized case. No production source changed for this correction.

| Check | Status | Result |
| --- | --- | --- |
| `npm.cmd run test -- src/app/App.test.tsx` (reproduction) | **FAIL** | 2/4 passed; both not-found cases failed because AuthContext was absent. |
| `npm.cmd run test -- src/app/App.test.tsx` (after fix) | **PASS** | 4/4 passed in one file. |
| `.\node_modules\.bin\prettier.cmd src\app\App.test.tsx --write` | **PASS** | File was already formatted. |

## Full component regression

No incomplete invocation is counted as passing. The requested monolithic retry limit and 300-second budget were retained.

| Command | Status | Complete result |
| --- | --- | --- |
| `node scripts/verify-remediation.mjs default 1` | **BLOCKED** | Timed out at 300 seconds; no final suite summary. One Expense assertion was logged before termination. Evidence ID `2026-10-15T12-35-41-176Z-default-1`. |
| `npm.cmd run test -- src/features/expenses/ExpensePages.test.tsx` | **PASS** | 41/41 passed in one file in 33.30 seconds. |
| `node scripts/verify-remediation.mjs single 1` | **BLOCKED** | The one allowed stable-config retry timed out at 300 seconds; no final suite summary and no assertion failure before termination. Evidence ID `2026-10-15T13-09-24-564Z-single-1`. |
| `npm.cmd run test -- --pool=forks --maxWorkers=1 --shard=1/2` | **BLOCKED** | Stopped at the 300-second ceiling without a final summary. Before termination, `ExpensePages.test.tsx` reported four failures: repeated void after `EXPENSE_ALREADY_VOIDED`, repeated void after `CONCURRENT_MODIFICATION`, category creation, and duplicate normalized names. |
| `npm.cmd run test -- --pool=forks --maxWorkers=1 --shard=2/2` | **NOT RUN** | Withheld because the instructions require stopping after a shard timeout. |

The aggregate sharded regression result is **BLOCKED**. The target 570/570 green baseline was not established. The independent 41/41 Expense result shows the four shard failures are sensitive to the broader run, but it does not turn the incomplete shard into a pass or prove their underlying cause.

The latest complete pre-fix run remains useful diagnostic evidence: 568/570 passed, with only the two now-corrected App provider cases failing. Because the post-fix complete inventory did not finish, it is historical evidence rather than the final baseline.

## Consolidated feature evidence

The repository's existing Vitest/MSW tests and prior completed focused runs cover the following behavior. This table describes executed local test evidence; it does not claim a fresh end-to-end live-backend run.

| Area | Status | Evidence reviewed |
| --- | --- | --- |
| Authentication | **PASS** | Login, registration, recovery/session behavior, logout, safe return routes, `/session`, public navigation, and the corrected App cases are covered by App, AuthPages, session, return-to, and route tests. |
| Organizations | **PASS** | Workspace selection/switching, membership revalidation, onboarding, forbidden routes, permission boundaries, and organization/account cache clearing are covered by Workspace, CreateOrganization, permissions, and query lifecycle tests. |
| Customers | **PASS** | Create, list/search, update, archive, filters, paging, optimistic concurrency, tenant cache scope, and permission denial have component coverage. |
| Invoices | **PASS** | Draft creation/editing, issue and lifecycle actions, customer selection, filtering, paging, `If-Match`, permissions, and safe return routes have component/contract coverage. |
| Payments | **PASS** | Record, list/detail, reversal, status display, stable idempotency keys on replay, permissions, and tenant cache isolation have component/contract coverage. |
| Expenses | **PASS** focused / **BLOCKED** suite | The entire Expense file passed 41/41 independently, covering categories, create/update/void, filters, paging, concurrency, and permissions. The same file reported four failures inside the timed-out shard, so full-suite stability remains blocked. |
| Financial analytics | **PASS** focused evidence | Cash Flow, Profit & Loss, aging, date/grouping controls, permission handling, Decimal parsing/presentation, and exact-value table alternatives have component/contract coverage. The frontend displays backend-provided totals and does not calculate authoritative financial truth. |
| Reports | **PASS** | The latest Stage 3 focused group passed with Notifications/Audit (112 tests collectively). Preview, export request/history/status/download, stable idempotency replay, permission denial, tenant isolation, and safe filename handling are covered. |
| Notifications | **PASS** | The same 112-test focused result covers unread/read presentation, one-way mark-read, archive confirmation, permission-aware resource links, recipient/account cache scope, and stale response handling. |
| Audit Logs | **PASS** | The same focused result covers readable labels, filters/paging, safe bounded metadata projection/redaction, unknown action fallback, and read-only presentation. |

No backend, schema, API contract, financial calculation, authentication policy, permission map, or tenant rule changed during this stabilization correction.

## Browser, responsive, and accessibility evidence

- **PASS — existing compiled-browser baseline:** `node scripts/verify-remediation.mjs browser 1` completed 17/17 simulated Edge scenarios on 2026-10-14. It checked 21 route renderings at eight widths, axe scans, navigation, responsive tables, charts, dialogs, downloads, keyboard behavior, and focus handling. See `docs/frontend-test-stability.md` and `docs/frontend-ui-polish.md`.
- **PASS — final Stage 3 activity UI:** `npm.cmd run test:e2e -- --config playwright.preview.config.ts activity.spec.ts --output test-results/activity-final --max-failures 1` completed 8/8 in 48.2 seconds on compiled assets. Notifications and Audit Logs passed at 320, 375, 390, 768, 1024, 1280, and 1440 px; compact empty states passed at 320 and 1440 px. It included axe checks, horizontal overflow, native disclosure keyboard behavior, archive focus restoration, and filter visibility. See `docs/frontend-activity-ui-redesign.md` for reviewed screenshots and local artifact links.
- **NOT RUN — fresh consolidated Playwright pass:** production source did not change after the cited Stage 3 build/browser pass, and this continuation changed only `App.test.tsx` plus this report. A further browser process was not started after the unit shard exhausted its 300-second budget. The checks above use MSW/transport simulation and do not establish live-backend or production behavior.

Automated axe results and semantic/keyboard checks found no violations in the cited passing scenarios. They do not constitute formal WCAG certification. Responsive screenshots already reviewed include login/registration, onboarding, Dashboard, Cash Flow, Notifications, Audit Logs, expanded disclosures, archive confirmation, and compact empty states across mobile and desktop widths.

## Security invariants reviewed

**PASS — source and existing coverage review.** No security boundary changed in this milestone. Existing tests and source retain:

- allowlisted same-application return routes, with malformed, unsupported, and external destinations rejected;
- current-session and current-membership validation, with client permission controls treated only as UI hints and backend authorization remaining authoritative;
- user and organization identifiers in TanStack Query keys, plus query cancellation/removal during account or organization transitions;
- canonical permission constants and fail-closed unknown permission behavior;
- exact optimistic concurrency headers where the API contract requires them;
- generated idempotency keys and reuse of the original key for approved mutation replay;
- safe CSV filename/content-disposition handling and permission-aware download behavior;
- audit metadata allowlisting/redaction rather than arbitrary payload rendering;
- notification permission and recipient/account-scoped cache handling.

## Quality gates

| Command | Status | Result |
| --- | --- | --- |
| `npm.cmd run typecheck` | **PASS** | Exit 0. |
| `npm.cmd run lint` | **PASS** | Exit 0. |
| `npm.cmd run format:check` | **PASS** | All matched files use Prettier formatting. |
| `npm.cmd run build` | **PASS** | TypeScript passed; Vite transformed 846 modules and built in 10.28 seconds. |
| `git diff --check` | **PASS** | No whitespace errors before verification; final check recorded below. |

## Bundle measurement

`npm.cmd run size:initial` completed successfully against the fresh production build:

- Initial static JavaScript graph: **475.84 kB**.
- Initial gzip sum: **145.52 kB**.
- Entry: **280.45 kB**; shared contracts: **195.39 kB**.
- Major lazy chunks: BarChart 322.58/93.55 kB gzip; FinancialChart 40.05/10.85; Payment 28.06/8.38; Invoice 27.90/8.12; Reports 17.30/5.76; Audit Logs 12.17/4.45; Notifications 10.19/3.65.

This matches the previous 475.84/145.52 kB result; no dependency was added and no meaningful initial graph change was observed.

## Limitations and release assessment

Frontend stabilization is **BLOCKED**, not complete, because neither the post-fix monolithic suite nor the two-shard aggregate produced a complete passing result. The App defect itself is resolved, focused Expenses are green, quality gates pass, and the existing redesign/browser/security evidence remains valid within the simulated environment.

Remaining release blockers:

1. Obtain one complete post-fix frontend inventory in hosted CI or another stable environment and require every test to pass. Preserve the current deadlines and assertions while diagnosing the Expense interactions seen only in broad runs.
2. Run a current consolidated Playwright pass if release policy requires one build-wide browser result after all Stage 1–3 changes.
3. Complete staging checks against real APIs, PostgreSQL, Redis/BullMQ, report workers, authorization, downloads, and audit/notification side effects. The local MSW checks cannot validate those cross-layer guarantees.

No application production-readiness claim is made. No files were staged, committed, pushed, or deployed.
