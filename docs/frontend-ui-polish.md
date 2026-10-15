# Frontend UI polish

## Scope and initial audit

The frontend already had the approved palette, permission-aware routes, a keyboard-managed mobile drawer, responsive tables, and accessible financial chart alternatives. The presentation was uneven: the sidebar used text-only, loosely spaced links; the header gave the organization selector too much width; dashboard figures had similar visual weight; page cards, tables, controls, and headings varied in density. Authentication headings and cards were larger than the workspace style.

This milestone changes frontend presentation only. Existing route permissions, API calls, data calculations, forms, confirmation flows, and financial disclosures remain in place.

## Design system and application shell

- Retained Deep Teal `#123c46`, workspace `#f4f7fb`, white cards, primary blue `#2563eb`, and the approved success, warning, and danger hues.
- Added semantic tokens for stronger borders, sidebar hover/muted text, row hover, focus halo, compact controls, sidebar width, and card shadow. Typography uses a shared title scale; buttons and form controls use a common minimum height.
- Grouped available navigation into Overview, Operations, Financial analytics, Management, and Organization. Permission checks still decide which links appear. Removed the nonfunctional Settings teaser. Added small inline SVG icons and a compact brand mark without a package dependency.
- The desktop sidebar is 248 px wide, sticks to the viewport, and scrolls independently. The header and organization selector are more compact. The existing mobile drawer, focus handling, and organization switching behavior are retained.

## Pages updated

- Dashboard: compact context heading and date controls; KPI cards have clear labels, larger tabular monetary values, semantic top accents, and decorative marks. The simplified cash-basis and current-state disclosures remain visible. Empty results remain truthful.
- Customers, Invoices, Payments, Expenses: tighter table rows, consistent page gaps and card shadows. Customer status text has a labelled pill treatment. Existing mobile table labels and confirmation dialogs remain.
- Cash Flow, Profit & Loss, Receivables Aging: shared analytics cards, date controls, disclosures, and exact-value tables use the same density and surface treatment. Charts and their accessible exact-value tables remain unchanged in data and scaling.
- Notifications, Reports, Audit Logs: compact list and card surfaces; unread notification emphasis; report status pills; shared workspace table, form focus, and heading styles. Audit remains read-only.
- Authentication and organization onboarding: tighter authentication type and card scale; shared controls, focus states, and shell card surfaces align with the workspace.

## Responsive and accessibility

The existing 768 px mobile drawer breakpoint, 480 px compact layouts, table reflow or horizontal scroll regions, and reduced-motion behavior remain. Sidebar scrolling prevents lower authorized routes from becoming unreachable on short desktop windows. Interactive controls have a 44 px minimum height, visible focus, hover, and disabled states. Icons are decorative; navigation labels and status words remain in text. Exact financial values remain available in tables beside the charts.

## Verification

Executed from `frontend/`:

| Check | Result |
| --- | --- |
| `npm.cmd run test -- src/app/App.test.tsx src/organizations/Workspace.test.tsx src/features/dashboard/DashboardPage.test.tsx` | 46/46 passed in 3 files |
| `npm.cmd run build` | Passed; typecheck and production build, 843 modules |
| `npm.cmd run lint` | Passed |
| `npm.cmd run format:check` | Passed after formatting the modified files |
| `npm.cmd run size:initial` | 475.60 kB initial static JS graph; 145.39 kB gzip sum |
| `npm.cmd run test:e2e` | 17/17 Edge tests passed, including 21 route checks at eight widths and axe scans |
| `npm.cmd run test -- --pool=forks --maxWorkers=1` | 561/568 passed; 7 failures in AuthPages and FinancialPages with session-loading or timing symptoms |
| `npm.cmd run test -- src/features/auth/AuthPages.test.tsx src/features/financials/FinancialPages.test.tsx --pool=forks --maxWorkers=1` | 38/38 passed on focused rerun |
| `git diff --check` | Passed |

The latest documented pre-polish graph was 474.02 kB / 144.81 kB gzip, so this change adds 1.58 kB / 0.58 kB gzip. Business routes remain lazy loaded; no dependency was added. The measured entry chunk is 280.20 kB, shared contracts chunk 195.39 kB, and the existing Recharts BarChart chunk 322.58 kB.

Opened local screenshots from the browser suite: onboarding at 390 and 1280 px, Audit Logs at 320 px, Dashboard at 320 and 1440 px, and Cash Flow at 1440 px. The shell, cards, chart, tables, and disclosures were legible at those sizes. Exact-value tables scroll within their regions on narrow screens. The 320 px Audit screenshot prompted a one-line mobile header width adjustment. A fresh-build `npm.cmd run test:e2e -- --grep 320px` rerun reported both 320 px tests passed and its new Dashboard screenshot was inspected. The command then stalled during teardown and was interrupted, so its process exit was 1. Simulated browser results do not establish live backend or production behavior.

The full component suite is **not green**. The seven failures appeared after slow test scheduling and session-loading waits; the same two files passed together immediately afterward. No test timeout, assertion, or fixture was changed. This matches the repository's recorded intermittent Windows stability issue, but this run alone does not prove the underlying cause.

## Remaining limitations

This is a visual refinement of existing components. Dense tables still use their established mobile reflow or scroll patterns, and chart data remains subject to the backend's current-state reporting semantics. No new component library or business route was introduced.
