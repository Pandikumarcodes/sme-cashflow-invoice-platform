# Financial analytics and reports UI redesign — Stage 2

## Initial audit and decisions

The financial pages already used authoritative report responses, shared money formatting, accessible exact-value tables and Recharts data alternatives. Their primary UI issue was hierarchy: disclosures appeared before the financial summary, while Reports exposed raw column and parameter names.

Stage 2 keeps period controls, report parameters, query contracts, organization scope and permissions intact. Cash Flow, Profit & Loss and Aging now lead with their short business purpose, controls, totals and visual/table detail; the required current-state disclosures follow the material data. Financial and report tables use compact uppercase headers, hover context and tabular values.

## Reports

Preview columns and export parameter labels are mapped to readable business language without changing their underlying API keys or values. Export creation, history, manual refresh, status, idempotency and secure server-side CSV downloads are unchanged.

## Accessibility and responsive behavior

Existing semantic headings, labelled controls, chart table alternatives, scrollable table regions, focus styling and no-animation chart configuration remain. The existing responsive KPI grid and controls are retained; no new collapsible control was introduced.

## Verification and limitations

This is presentation-only. Browser screenshots and full test/build verification remain pending in this bounded implementation session; no unexecuted check is claimed as passing. No backend, financial calculation, API, tenant-scope, RBAC, download or report-generation behavior changed.
