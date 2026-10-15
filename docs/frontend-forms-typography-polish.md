# Frontend forms and typography polish

## Form inventory

This audit covers existing controls only. Search fields and filters are kept within
their current API/query contracts.

| Area | Existing fields and controls | Layout / shared pattern |
| --- | --- | --- |
| Authentication | Sign in, registration, session recovery | Auth module field rows, inline password visibility control, primary/secondary actions |
| Organization | Organization creation: legal name, display name, base currency, timezone; organization switcher | Bounded onboarding form and header select; no membership or invitation management form exists |
| Customers | Create/edit name, code, email; directory search/status/sort/page filters | Customer field/grid, compact filter group, existing archive confirmation |
| Invoices | Customer picker/search, issue/due dates, tax rate, discount type/value, repeating line item description/quantity/unit price; list filters | Responsive grid, item fieldsets, totals preview and action row; issue/cancel confirmations remain explicit |
| Payments | Eligible invoice picker/search; amount, date, method; history invoice/status/method/date/sort/page filters | Payment field/grid and filter card; full reversal retains its reason/date confirmation dialog |
| Expenses | Category, amount, date, description, optional vendor/reference/notes; list/category filters | Expense field/grid and category picker; void remains a confirmation flow |
| Financial analytics | Dashboard range preset/dates; Cash Flow and P&L dates/grouping; aging as-of date | Compact responsive period toolbar with inline validation |
| Notifications | Status/type/read filters and supported read/archive actions | Existing compact control group; no text search is implemented |
| Reports | Report type, date/as-of range, supported optional identifiers/vendor/category, status/grouping; export status/history/page controls | Responsive report parameter fieldset and export controls |
| Audit logs | Date bounds, actor/action filters and page controls | Read-only filter toolbar |

Repeated control layouts already use feature CSS Modules (`field`, `grid`,
`filters`/`controls`, `actions`). The audit found no need for a new React form
component abstraction.

## Initial visual findings

The existing uncommitted UI polish already establishes the application shell,
palette, typography tokens, tighter page/card/table spacing and feature-level
form layouts. The remaining form-level inconsistency was repeated input styling
across CSS Modules: border, height, font size, labels, focus/error and disabled
states were not guaranteed to match. An invoice discount validation message was
not programmatically associated with its control. Native controls and browser
calendar interaction were retained.

## Typography decisions

- Use the existing Inter-first system stack across the app; no web font asset or
  dependency was added.
- Set body/control text to 15px, labels to 14px, and keep existing page title,
  section, helper and KPI tokens.
- Keep tabular numerals on date and decimal-entry controls and existing financial
  tables. No formatting or financial precision changed.
- Reuse the existing approved palette and semantic control tokens.

## Shared control changes

- Added shared label, text input, select, textarea, checkbox/radio, disabled,
  invalid and button typography baselines in `frontend/src/styles/globals.css`.
- Added reusable label/control sizing and radius tokens in
  `frontend/src/styles/tokens.css`.
- Kept component/module layout and button color variants intact. Inputs continue
  to use native select/date behavior and keyboard support.
- Connected invoice discount validation to its control with
  `aria-describedby`, `aria-invalid`, and a field-level alert ID.

## Page-by-page improvements

Authentication, organization onboarding, customer/invoice lists, payments,
expenses, analytics, notifications, reports and audit pages already had
feature-level layout and validation patterns in the starting working tree. This
change applies the shared control baseline across them. Existing create/edit
flows, confirmation dialogs, filters, query parameters, validation schemas and
API behavior are preserved.

## Responsive checks

The existing Playwright suite covers route rendering and horizontal overflow at
320, 375, 390, 768, 1024, 1280, 1440 and 1920 px, along with onboarding at 390
and 1280 px. New visual/browser results are recorded after this change is run.

## Accessibility checks

Shared focus-visible behavior, form labels, invalid borders and checkbox/radio
spacing are retained or standardized. Existing dialog focus, Escape and
restoration checks remain in the Playwright suite. No formal WCAG conformance is
claimed. New browser axe results are recorded after execution.

## Browser screenshots reviewed

Reviewed simulated screenshots for sign-in and registration at 640 px;
organization creation at 390 px; customer creation, invoice creation, payment
selection, expense creation, report/export history, Audit Logs and Dashboard
at 320 px. Organization onboarding at 1280 px was captured in the initial
browser run. These artifacts are generated under the ignored
`frontend/test-results/simulated/` directory; subsequent Playwright invocations
clear that output, so screenshots are not committed.

## Test results

- TypeScript typecheck: passed.
- ESLint: passed.
- Focused form/page Vitest: 246/246 passed across 9 files.
- Prettier check: passed.
- Production build: passed; 843 modules transformed.
- `git diff --check`: passed.
- Playwright full simulated suite: 9 passed, 8 failed. All 8 failures were
  axe `target-size` findings on resource links/disclosure summary controls at
  Audit Logs or Payment details. Those targets were corrected.
- Focused Playwright route/axe scans: 320 px passed after both fixes; 1440 px
  passed after the resource-link fix. A final 1440 px rerun stalled before test
  startup and was interrupted; no deadline or assertion was changed.
- Focused 320 px screenshot test passed and its images were reviewed. The
  Playwright process stalled during teardown and was interrupted after the
  passing test output; screenshots were captured before that interruption.
- The sign-in/registration screenshot test passed; its browser process also
  stalled during teardown after the passing output and was interrupted.
- Full frontend component suite was not rerun. The authoritative prior count in
  `docs/frontend-test-stability.md` is 568 tests across 29 suites.

## Bundle impact

No package or font asset was added. The initial static JavaScript graph remains
475.60 kB (145.39 kB gzip), unchanged from the prior UI polish milestone. The
entry chunk remains 280.20 kB and the shared contracts chunk 195.39 kB. The
global CSS grew from 21.93 kB (4.92 kB gzip) to 22.15 kB (4.96 kB gzip), a
0.22 kB raw / 0.04 kB gzip increase.

## Remaining issues

The final 1440 px browser rerun remains incomplete because this Windows
Playwright session stalled before test startup. The full component suite was not
run because the focused 246 tests passed and the repository documents severe
Windows timing sensitivity for broad runs. Current filters are limited to
controls and query parameters already implemented; there is no
membership/invitation management UI or notification text search form.
