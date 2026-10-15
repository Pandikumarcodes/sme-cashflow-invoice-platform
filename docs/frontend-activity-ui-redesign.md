# Activity UI redesign — Stage 3

Verification date: 2026-10-15 (Asia/Calcutta).

## Initial UI audit

The starting worktree contained Stage 1/2 changes across the shell, forms, operations and financial pages, including Notifications CSS. All were preserved. Initial `git diff --check` passed. Read repository rules, blueprint, frontend README, API contracts, domain rules and the five requested UI/stability documents. The forms inventory incorrectly describes notification type/read filters: the actual controls are state, created ordering and page size; no type filter is implemented or added.

Audit Logs emphasized raw action codes, actor/membership/resource UUIDs and source enums in nested cards. All eight filters occupied a large panel. Notifications had long implementation-facing descriptions, large cards and category labels above the primary title. Existing hooks already supplied account-scoped keys, cancellation, permission boundaries and opaque cursor navigation.

## Notifications improvements

The requested concise header, compact toolbar, title-first cards and text read-state badges retain every supported state, direction and page-size control. Unread rows retain a stronger title, left border and explicit Unread text. Body, category and organization-timezone timestamps remain readable. All existing scheduled/read/archive timestamps remain available. Counts still say **Unread on this page** and **Loaded notifications**. Refresh remains explicit; no polling, global count, new types or reminder controls were added.

The original one-way read and terminal archive flows, inline confirmation, pending lock, cancellation, retry handling and focus restoration remain intact. Empty/error/loading states and safe permission-aware resource links are retained.

## Audit Logs improvements

A dedicated CSS module isolates activity styling from Reports. Compact, separated records replace nested cards. Each leads with a human-readable verified action label, timestamp, actor type, resource type and textual outcome. No actor names are invented: the API returns historical IDs only. Changed-field summaries use the existing sanitized field selection.

Dates, order, page size and apply/clear/refresh stay visible. Less common exact action/resource/actor/ID filters use native disclosure, with an indicator when values are set. Inputs and draft/applied filter behavior, validation, cursor stack and query parameters remain unchanged. No hidden filter is discarded.

Native event disclosure contains original action code, resource type/ID, actor and membership IDs, source, request/correlation IDs and the existing bounded before/after projections. Arbitrary metadata, contacts, nested payloads and secrets continue to be omitted by the unchanged parser. Audit remains read-only.

## Presentation mappings

Verified against backend application writers: CUSTOMER_CREATED/UPDATED/ARCHIVED; INVOICE_CREATED/UPDATED/ISSUED/CANCELLED/VOIDED/DELETED; PAYMENT_RECORDED/REVERSED; EXPENSE_CREATED/UPDATED/VOIDED; EXPENSE_CATEGORY_CREATED/UPDATED/ARCHIVED; ORGANIZATION_CREATED/UPDATED/CLOSED; ORGANIZATION_INVITATION_CREATED/REVOKED/ACCEPTED; ORGANIZATION_OWNERSHIP_TRANSFERRED; MEMBERSHIP_REACTIVATED/REMOVED/ROLE_CHANGED/SUSPENDED; report.export.request and report.export.download. These have explicit readable labels, without changing stored or query values. Unknown actions, including the legacy synthetic fixture `invoice.issued`, use Recorded activity; the original code remains in details. Unknown resource types use Resource and have no new navigation.

## Accessibility and responsive behavior

Preserved semantic headings, lists, links, labelled controls, machine-readable time elements, global visible focus and 44px control targets. Native details/summary supports browser keyboard activation and excludes collapsed descendants from focus. Outcome and read state use text as well as color. Cards wrap long values, details grids reduce from three columns to two and one, and controls wrap at narrow widths. No decorative animation or dependency was introduced. Automated checks do not establish formal WCAG compliance.

## Verification ledger

All npm commands run from `frontend/` unless stated otherwise.

| Command                                                                                                                                                                                                 | Result                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                                                                                                                                                                                 | Passed                                                                                                                                                                                                                                                                  |
| `npm.cmd run lint`                                                                                                                                                                                      | Passed                                                                                                                                                                                                                                                                  |
| `npm.cmd run format:check`                                                                                                                                                                              | Passed                                                                                                                                                                                                                                                                  |
| `npm.cmd run build`                                                                                                                                                                                     | Passed; TypeScript + 846 transformed modules                                                                                                                                                                                                                            |
| `npm.cmd run test -- src/features/notifications/NotificationsPage.test.tsx src/features/notifications/contracts.test.ts src/features/audit/contracts.test.ts src/features/reports/ReportsPage.test.tsx` | Initial run: 103/111 passed; 8 failed. Seven Reports timing/loading failures; one new jsdom native-summary keyboard test failed. Corrected component test to click native summary; real keyboard behavior is tested in Playwright. No assertion/deadline/retry relaxed. |
| `npm.cmd run test -- src/features/reports/ReportsPage.test.tsx`                                                                                                                                         | Isolated rerun after disclosure correction: 36/36 passed. A further audit cursor/sanitization regression was added afterward; final result recorded below.                                                                                                              |

A mistaken root `npm.cmd run typecheck` invocation reported Missing script; rerun from the owning frontend directory passed. Python was unavailable for an initial edit attempt; it made no edits. Optional process/memory inspection was denied, so no resource-cause diagnosis is claimed.

## Screenshot verification

The new `frontend/e2e/activity.spec.ts` uses transport simulation only. It captures Notifications and Audit Logs at 320, 375, 390, 768, 1024, 1280 and 1440px; expanded audit metadata and archive confirmation; plus empty states at 320/1440px. It checks native disclosure keyboard activation, hidden filter controls, archive focus restoration, axe findings and expanded-state overflow. The first sandboxed 320px scenario passed (18.4 seconds), but its command stalled during teardown and was terminated after verifying the owned Node command lines. Its command exit was 1, not a successful run. The outside-sandbox activity run completed with 7/8 passing: all seven widths passed, while the new empty-state test failed on a malformed apostrophe in its test matcher. The matcher was corrected without changing product behavior or expectations.

Inspected 320px expanded Audit Logs and archive-confirmation images, and 1440px expanded Audit Logs and Notifications images. Readable hierarchy, wrapping IDs, action placement and focus outlines were visible. The mobile full-page capture shows an offscreen fixed skip-link capture artifact after scrolling to focused controls; the shared shell was not modified. Inspection prompted correction of an encoded separator, neutral pagination styling and explicit native disclosure markers. Final-source browser rerun is recorded below.

## Bundle impact

`npm.cmd run size:initial` on the existing build at start: 475.80 kB initial static JS graph, 145.51 kB gzip sum. New production build: 475.84 kB / 145.52 kB, approximately +0.04 / +0.01 kB. The start measurement used the build already present, rather than a fresh pre-edit build, so it is a reference comparison. Initial CSS is 22.75 kB / 5.06 kB gzip. Route CSS: Notifications 3.47 / 0.99 kB gzip; Audit Logs 4.10 / 1.16 kB gzip. No pre-edit CSS measurement was retained, so an exact CSS delta is unavailable. Both feature routes remain lazy loaded; no dependency, route or global stylesheet was changed.

## Files and scope

Created: `frontend/src/features/audit/AuditLogs.module.css`, `frontend/e2e/activity.spec.ts`, this document.

Modified: `frontend/src/features/audit/AuditLogsPage.tsx`, `presentation.ts`, `contracts.test.ts`; `frontend/src/features/notifications/NotificationsPage.tsx`, `Notifications.module.css`, `NotificationsPage.test.tsx`; `frontend/src/features/reports/ReportsPage.test.tsx` (audit tests only).

No backend, schema, API, financial, auth, permission-map, navigation, query-hook or audit-redaction implementation changed. `notification.read`, `notification.update_self` and `audit.read` remain enforced through existing boundaries. Existing recipient ownership, tenant checks, account cache isolation, stale-response cancellation and resource permission checks remain untouched. No architectural deviation. No staging, commit, push or deployment.

## Limitations and final git state

The historical Windows repeatability gate remains open as documented in frontend-test-stability.md. A single bounded full-suite attempt and final-source screenshot rerun are recorded below; incomplete output is never counted as a pass. Live backend delivery and audit atomicity are outside this UI-only verification. Existing unrelated modifications and untracked Stage 1/2 documents remain in the worktree.

## Final verification results

- `node scripts/verify-remediation.mjs default 1` (executes `npm.cmd run test`): completed in 170.458 seconds, exit 1; **568 passed, 2 failed, 570 total; 28/29 suites passed; no skips**. Both failures are `src/app/App.test.tsx` not-found route cases. They render the existing modified `FoundationLayout` without AuthContext, which now calls useAuth and throws Authentication requires the application provider. That layout was already modified at task start and is untouched here. These are application-test/provider integration failures, not attributed to Windows timing. No unrelated fix was made.
- All four Notifications/Audit/Reports suites passed in that final full run (112 tests collectively); the original tests remain enabled and the two added regression tests passed.
- Full-suite evidence: [metadata](../frontend/test-results/remediation/2026-10-15T10-42-23-795Z-default-1.json), [log](../frontend/test-results/remediation/2026-10-15T10-42-23-795Z-default-1.log).
- The next final-source browser attempt timed out before scenarios at the existing 60-second web-server startup deadline. Its build ran, but server readiness was not confirmed. It is not a browser pass. A compiled-preview rerun is recorded below.
- Final `npm.cmd run build`: passed after the last source change (846 modules); includes TypeScript checking. Final `npm.cmd run lint` and `npm.cmd run format:check`: passed. Final `npm.cmd run size:initial`: 475.84 kB / 145.51 kB gzip.
- `npm.cmd run test:e2e -- --config playwright.preview.config.ts activity.spec.ts`: completed **6/8 passed**, exit 1, 3.4 minutes. 320/768/1024/1280/1440px and compact empty states passed. 375px timed out while still Checking your session; 390px expired during axe scanning. No assertion violation was reported by axe; incomplete scans are not passes.
- `npm.cmd run test:e2e -- --config playwright.preview.config.ts activity.spec.ts --grep 3[79][05]px --output test-results/activity-focused`: **2/2 passed**, exit 0, 37.6 seconds, against the same compiled assets. Each requested width therefore has a completed passing final-build scenario, but that run was not wholly green; the final run below supersedes it. An earlier grep containing a pipe was misinterpreted by npm/Windows cmd and ran no scenario; the bracket expression avoids that shell separator.
- Screenshots inspected from compiled preview: Notifications empty at 320px, Audit empty at 1440px, and Audit expanded at 1440px. Inspection found shared shell flex styling suppressing native disclosure markers, addressed with a local list-item override; a final marker/reflow smoke follows below.

## Completed final check

`npm.cmd run test:e2e -- --config playwright.preview.config.ts activity.spec.ts --output test-results/activity-final --max-failures 1`: **8/8 passed**, exit 0, 48.2 seconds, after the last product and browser-test change. All seven widths passed expanded-state overflow and axe checks for both pages; disclosure Enter-key behavior, collapsed filter visibility, list-item marker rendering and archive confirmation/restored focus passed. Empty states passed at 320 and 1440px. This is the final browser result; earlier failures are retained above as history.

Final build, lint, format checks and size measurement passed. Final initial graph: **475.84 kB / 145.52 kB gzip**. Final Audit route CSS: **4.10 kB / 1.16 kB gzip**. Product source has not changed since this build and browser pass. The full unit result remains **568/570**, with the two untouched App provider failures; this is not an entirely green frontend baseline.

Final screenshots were captured for both pages at every requested width and expanded state. Inspected final 320px and 1440px expanded Audit details and 320px notification archive confirmation: arrows, focus outlines, metadata wrapping and action placement are visible. Prior compiled-build empty-state screenshots were also inspected; the final run refreshed them. All screenshots use synthetic transport fixtures and are ignored local artifacts.

| Evidence                         | Local screenshot                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notifications desktop            | [1440px](../frontend/test-results/activity-final/activity-activity-redesign-da01a-sures-and-actions-at-1440px-edge/notifications-1440.png)                     |
| Notifications mobile and actions | [320px confirmation](../frontend/test-results/activity-final/activity-activity-redesign-c3e70-osures-and-actions-at-320px-edge/notifications-expanded-320.png) |
| Audit desktop details            | [1440px expanded](../frontend/test-results/activity-final/activity-activity-redesign-da01a-sures-and-actions-at-1440px-edge/audit-logs-expanded-1440.png)      |
| Audit mobile details             | [320px expanded](../frontend/test-results/activity-final/activity-activity-redesign-c3e70-osures-and-actions-at-320px-edge/audit-logs-expanded-320.png)        |
| Notifications empty              | [320px](../frontend/test-results/activity-final/activity-activity-redesign-compact-empty-states-edge/notifications-empty-320.png)                              |
| Audit empty                      | [1440px](../frontend/test-results/activity-final/activity-activity-redesign-compact-empty-states-edge/audit-logs-empty-1440.png)                               |

No requested screenshot category remains unexecuted. Live APIs, real worker delivery and formal accessibility certification were not tested by these simulations. The initial CSS delta remains unmeasured; the initial-JS reference used the build present at task start.

Final `git status --short` (all initial changes preserved; only the activity files listed above were edited by this milestone):

```text
 M frontend/e2e/readiness.spec.ts
 M frontend/src/components/layout/FoundationLayout.tsx
 M frontend/src/features/analytics/AgingPage.tsx
 M frontend/src/features/audit/AuditLogsPage.tsx
 M frontend/src/features/audit/contracts.test.ts
 M frontend/src/features/audit/presentation.ts
 M frontend/src/features/auth/AuthPages.module.css
 M frontend/src/features/auth/AuthPages.test.tsx
 M frontend/src/features/auth/AuthPages.tsx
 M frontend/src/features/customers/Customers.module.css
 M frontend/src/features/customers/CustomersPages.test.tsx
 M frontend/src/features/customers/CustomersPages.tsx
 M frontend/src/features/dashboard/Dashboard.module.css
 M frontend/src/features/dashboard/DashboardPage.tsx
 M frontend/src/features/expenses/ExpensePages.test.tsx
 M frontend/src/features/expenses/ExpensePages.tsx
 M frontend/src/features/expenses/Expenses.module.css
 M frontend/src/features/financials/FinancialPages.tsx
 M frontend/src/features/financials/Financials.module.css
 M frontend/src/features/invoices/InvoiceForm.tsx
 M frontend/src/features/invoices/InvoicePages.test.tsx
 M frontend/src/features/invoices/InvoicePages.tsx
 M frontend/src/features/invoices/Invoices.module.css
 M frontend/src/features/notifications/Notifications.module.css
 M frontend/src/features/notifications/NotificationsPage.test.tsx
 M frontend/src/features/notifications/NotificationsPage.tsx
 M frontend/src/features/payments/PaymentPages.test.tsx
 M frontend/src/features/payments/PaymentPages.tsx
 M frontend/src/features/payments/Payments.module.css
 M frontend/src/features/reports/Reports.module.css
 M frontend/src/features/reports/ReportsPage.test.tsx
 M frontend/src/features/reports/ReportsPage.tsx
 M frontend/src/organizations/Workspace.module.css
 M frontend/src/organizations/Workspace.tsx
 M frontend/src/styles/globals.css
 M frontend/src/styles/tokens.css
?? docs/frontend-activity-ui-redesign.md
?? docs/frontend-financial-ui-redesign.md
?? docs/frontend-forms-typography-polish.md
?? docs/frontend-operations-ui-redesign.md
?? docs/frontend-ui-polish.md
?? frontend/e2e/activity.spec.ts
?? frontend/src/components/filters/
?? frontend/src/features/audit/AuditLogs.module.css
```
