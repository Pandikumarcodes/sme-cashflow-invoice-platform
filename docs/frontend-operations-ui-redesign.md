# Operations UI/UX redesign — Stage 1

## Initial audit

Customers, Invoices, Payments and Expenses each rendered every supported filter in a full-width card before their results. This pushed record tables below the first viewport and exposed several API-facing sort values. The existing tenant scope, permission gates, debounced searches, cursor pagination and asynchronous customer/category choices were retained.

## Design decisions

The four list pages now share a compact operations toolbar. The controls used most often remain visible; less frequent controls are in an explicitly expanded advanced panel. The page headers use concise task-oriented descriptions and preserve the existing permission-gated primary actions. Tables now have compact uppercase headers, subtle hover surfaces, stronger primary-record links and tabular, emphasized monetary columns.

## Shared filter pattern

`OperationsFilterToolbar` is a small compositional component, not a schema framework. Its native More filters button has `aria-expanded` and `aria-controls`; the advanced panel uses `hidden` while collapsed, preventing hidden controls from receiving keyboard focus while retaining their React state. Clear filters resets the existing page filter state and cursor. No request parameter or query-key shape changed.

### Layout correction

Follow-up browser review identified CSS grid stretching rather than a control-height token defect. The toolbar's auto-fit grids had default stretch alignment, so the multi-control customer/category fieldsets made adjacent simple fields fill an oversized row; the toolbar action area consequently aligned to that row's bottom. Simple filter grids now use start alignment and the customer/category pickers render in their own full-width advanced supplement beneath those grids. This preserves every picker control and keeps collapsed toolbars compact.

## Page changes

- Customers: search and status are primary; sorting and page size are advanced.
- Invoices: search, invoice status and payment state are primary; overdue, customer choice, date ranges, sorting and page size are advanced. Sort labels are human-readable while API values remain unchanged.
- Payments: status and method are primary; invoice UUID, dates, sorting and page size are advanced.
- Expenses: vendor search, status and category choice are primary; dates, sorting and page size are advanced. Expense Categories remains available from the existing header action.

## Responsive and accessibility verification

The toolbar grid wraps to a single column on narrow screens; buttons grow to accessible full-width controls. Existing semantic tables retain their mobile representation. Visible focus styling remains global, and collapsible controls are removed from sequential keyboard navigation while hidden. This work does not claim formal WCAG conformance.

## Verification and limitations

`npm.cmd run typecheck` passed after the redesign. Focused component tests were updated to open the advanced panel before exercising advanced query controls; one focused Customers invocation exited successfully but this Windows Vitest environment did not emit its normal final summary. Full lint, full suite, production build and Playwright screenshots have not yet been run for this change. Browser screenshots were therefore not inspected in this implementation session.

There are no backend, authorization, financial-calculation, routing or dependency changes. Bundle impact is limited to the small lazy-imported toolbar component and CSS module; a new production size measurement remains pending.

The follow-up correction passed Prettier format checking and TypeScript checking. The local chained verification command did not progress to its remaining lint/test/browser steps before this bounded session ended, so those checks and fresh visual screenshots remain outstanding.
