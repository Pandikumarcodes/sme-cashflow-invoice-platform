# Product Requirements

## Document status

- Product: SME Cash Flow & Invoice Management System
- Scope: backend-first MVP requirements; React is out of scope
- Architecture target: production-style modular monolith
- Status: proposed baseline requiring review before implementation

## 1. Product overview

The product is a multi-tenant SaaS for small and medium businesses to manage customers, invoices, recorded payments, expenses, receivables, and simplified financial performance. It is an operational finance tool, not a bank, payment processor, tax engine, payroll product, or full double-entry accounting system.

### Problem statement

SMEs often track invoices and expenses in disconnected spreadsheets, cannot reliably see what is overdue or collected, and lack a trustworthy cash view. The system must provide one auditable source of truth while preventing one organization from accessing another organization's data.

### Target users

- Business owners who need financial visibility and administrative control.
- Administrators who manage staff and organization settings.
- Accountants/bookkeepers who manage invoices, payments, expenses, and reports.
- Operational members who manage customers and invoices.
- Viewers who need read-only operational and financial access.

### Product goals

1. Produce accurate invoices from server-calculated line items.
2. Track receivables through partial and complete payments.
3. Record business expenses and show cash movement.
4. Provide clear cash-basis management reports.
5. Guarantee tenant isolation and permission-based access.
6. Preserve an audit trail for material financial and administrative actions.
7. Expose stable REST APIs suitable for a later React client.

### Success indicators

- A new organization can create, issue, and settle an invoice without manual total calculations.
- Dashboard/report values reconcile to the underlying payments and expenses for the same period.
- Cross-tenant access tests fail closed for every resource family.
- Every privileged or financial mutation produces an audit record.
- Duplicate retried payment requests do not create duplicate payments.

## 2. Scope

### MVP

- Email/password registration, login, logout, short-lived access tokens, rotating refresh sessions, and account disablement.
- Organization creation/profile, one owner, base currency, timezone, invoice settings.
- Memberships with Owner, Admin, Accountant, Member, and Viewer roles, plus a secure invitation lifecycle; email delivery remains provider-gated and an invite can be surfaced through a protected development/admin flow until enabled.
- Customer CRUD with archive behavior.
- Draft, issue, cancel, and view invoices with immutable issued financial terms.
- Line items, invoice-level fixed or percentage discount, and invoice-level tax rate.
- One positive recorded payment applied to exactly one invoice; partial payments and reversals.
- Expense CRUD/archive with categories.
- Cash-basis cash flow, simplified cash-basis P&L, receivables, collection, and overdue metrics.
- In-app notifications and scheduled reminder records; email delivery behind a provider interface.
- CSV reports; asynchronous export only when result size warrants it.
- Immutable application audit log.
- Health, structured logging, correlation IDs, rate limiting, validation, and API documentation during implementation.

### Later phases

- Password reset/email verification, MFA, SSO, custom roles, and granular custom permissions.
- Advanced invitation administration, resend policies, and configurable email templates.
- Attachments, branded invoice PDFs, recurring invoices, credit notes, customer portal, quotes, and estimates.
- True multi-currency with exchange rates and realized/unrealized gains.
- Payment allocation across invoices, customer credits, refunds, and payment gateway integrations.
- Accrual accounting, taxes by jurisdiction, double-entry ledger, bank feeds/reconciliation, payroll, inventory, purchase orders.
- Configurable notification templates/channels and advanced analytics/materialized aggregates.
- PostgreSQL Row Level Security (RLS) after operational readiness.

### Non-goals

- React or any frontend implementation in this phase.
- Direct card storage or processing; recorded payment metadata must never contain PAN/CVV.
- Legal tax filing, GAAP/IFRS compliance claims, full ERP/accounting, or multi-currency accounting.
- Microservices, Kafka, event sourcing, distributed transactions, Kubernetes, or database-configured permissions in MVP.

## 3. Actors and authority

| Actor | Description | Typical authority |
|---|---|---|
| Unauthenticated visitor | No session | Register and log in only |
| Authenticated user | Global identity | Manage own profile and sessions; no tenant data without active membership |
| Owner | Exactly one active owner membership per organization | All tenant operations, ownership transfer, organization lifecycle |
| Admin | Operational administrator | Settings and members, except ownership transfer/destructive lifecycle actions |
| Accountant | Finance operator | Customers, invoices, payments, expenses, reports, audit viewing |
| Member | Day-to-day operator | Customers and draft/issue invoices; no payments reversal or organization administration |
| Viewer | Read-only stakeholder | View customers, invoices, analytics/reports; no mutations or member data administration |
| Worker | Trusted background process | Only the tenant-scoped operation encoded in a validated job payload |

Role checks are translated to permissions by a centralized policy layer. Business services enforce sensitive permissions again; no business rule relies solely on a controller decorator.

## 4. Cross-cutting requirements

### Multi-tenancy

- `Organization` is the tenant boundary. A global `User` may have memberships in multiple organizations.
- An organization identifier appears in tenant API routes for clarity: `/api/v1/organizations/:organizationId/...`.
- The path value selects a requested tenant; it does not confer access. The backend obtains the user from the access token, loads an active membership for `(userId, organizationId)`, and establishes a trusted tenant context.
- Body/query `organizationId` fields are rejected or ignored; tenant-owned foreign keys come from trusted context.
- Every tenant-owned lookup includes `organizationId`, even when the resource UUID is globally unique. Cross-tenant resources return `404` to avoid enumeration.
- Jobs and exports carry `organizationId` plus resource IDs and repeat tenant-scoped loading in the worker.

### Validation

All inputs use allowlisted DTOs with transformation disabled unless explicit, unknown properties rejected, lengths bounded, UUID/date/enum formats checked, and database constraints as a second line of defense. Strict validation is required for authentication, currency, timezone, membership roles, invoice dates/lines/tax/discount, payment amounts/dates/idempotency keys, expense amounts/dates, report date ranges, filters, and export formats.

### Time and dates

- Instants (`createdAt`, payment recording time, audit time) are stored in UTC.
- Business dates (`issueDate`, `dueDate`, `paymentDate`, `expenseDate`) are date-only values.
- A report range is inclusive `[fromDate, toDate]` in the organization's IANA timezone. When querying instants, it maps to a half-open UTC interval `[local start, day-after-end local start)` to handle daylight-saving transitions.
- The organization's timezone at report execution controls interpretation. Historic records retain business dates, so later timezone changes do not alter their assigned dates.

## 5. Authentication and users

### Global User versus Membership

`User` owns global identity: normalized email, password hash, display name, global account status, authentication/security timestamps. `Membership` owns organization-specific identity and authority: organization, user, role, status, optional organization display/job title, invitation/join timestamps. Roles never live on `User`.

### Authentication requirements

- Registration creates only a global user. After login, organization creation explicitly and atomically creates the Organization plus Owner membership and tenant defaults.
- Login accepts normalized email/password, applies rate limits, and returns a short-lived signed access token and an opaque rotating refresh token.
- Passwords use Argon2id with reviewed cost parameters. Passwords and raw tokens are never logged.
- A `RefreshSession` stores the login family and immutable `RefreshToken` rows store only token hashes for each rotation. Rotation invalidates the previous token atomically; reuse of an already-used token revokes the session family.
- Logout revokes the current session; “logout all” revokes all user sessions.
- Access tokens contain identity/session identifiers, not trusted organization roles. Membership is rechecked for tenant operations.
- Disabled users cannot log in, refresh, or access APIs. Membership suspension only affects that organization.
- Password reset and email verification are recommended immediately after core MVP, or in MVP before public launch.

### Failure cases

Use a generic invalid-credentials response; fail closed on revoked/expired/malformed tokens; detect refresh replay; do not disclose whether an email exists in recovery flows; return `401` for unauthenticated and `403` for authenticated but unauthorized operations, except cross-tenant resource access which returns `404`.

## 6. Organizations, memberships, and RBAC

### Organization

Required attributes are legal/display name, slug (optional public-friendly identifier), base ISO 4217 currency, IANA timezone, invoice prefix, invoice payment terms default, and lifecycle status (`ACTIVE`, `SUSPENDED`, `CLOSED`). Currency becomes immutable after the first invoice or expense; changing it later requires a future controlled migration.

Organization creation and Owner membership are atomic. A closed/suspended tenant cannot perform normal mutations. Closure is a protected, auditable lifecycle operation and should initially be support-assisted rather than immediate deletion.

### Membership lifecycle

Persist Membership status as `ACTIVE`, `SUSPENDED`, or `REMOVED`; an invitation is a separate `OrganizationInvitation` with `PENDING`, `ACCEPTED`, `REVOKED`, or `EXPIRED`. Only an ACTIVE Membership grants access. `(organizationId, userId)` is permanently unique. Removal preserves historical attribution and reactivation reuses the row. The Owner cannot be suspended, removed, or downgraded until ownership is atomically transferred. The last Owner invariant is enforced in a transaction.

Invitation acceptance must bind the intended normalized email and use a single-use, expiring hashed token. If invitations are deferred, only existing registered users may be added by a safe administrator flow.

### Permission matrix

Legend: ✓ allowed, — denied, L limited (cannot affect Owner or perform ownership/lifecycle actions).

| Permission/action | Owner | Admin | Accountant | Member | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| View organization | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage organization settings | ✓ | ✓ | — | — | — |
| Transfer ownership / close organization | ✓ | — | — | — | — |
| Manage memberships | ✓ | L | — | — | — |
| Assign roles | ✓ | L | — | — | — |
| View/manage customers | ✓ | ✓ | ✓ | ✓ | view |
| View invoices | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/edit draft invoice | ✓ | ✓ | ✓ | ✓ | — |
| Issue invoice | ✓ | ✓ | ✓ | ✓ | — |
| Cancel/void invoice | ✓ | ✓ | ✓ | — | — |
| Record payment | ✓ | ✓ | ✓ | — | — |
| Reverse payment | ✓ | ✓ | ✓ | — | — |
| View/manage expenses | ✓ | ✓ | ✓ | — | view |
| View financial analytics | ✓ | ✓ | ✓ | — | ✓ |
| Export reports | ✓ | ✓ | ✓ | — | ✓ |
| View audit logs | ✓ | ✓ | ✓ | — | — |

Permissions are code-defined and version-controlled in MVP. Custom roles and database-defined permissions are later features.

## 7. Customers

Customer data includes organization-scoped customer code (optional), display/legal name, email, phone, billing address fields, tax identifier (optional and access-controlled), payment terms override, notes, and status (`ACTIVE`, `ARCHIVED`). Name is required; email must be syntactically valid if supplied.

Archiving prevents selection for new invoices but preserves existing documents. Customers referenced by invoices are not hard-deleted. Duplicate names are allowed; optional customer code is unique within an organization. Every operation is tenant-scoped and requires customer permissions.

## 8. Invoices and invoice items

### Persisted and derived lifecycle

Persisted `Invoice.status` is deliberately small:

- `DRAFT`: editable and unnumbered or allocated only at issue.
- `ISSUED`: finalized financial document; terms and lines are immutable.
- `CANCELLED`: cancelled after issue when no Payment rows have ever existed; excluded from receivables and revenue-style reporting.
- `VOID`: administratively invalidated after issue when no active payments remain; it may retain fully reversed payment history and is preserved for audit.

`PARTIALLY_PAID`, `PAID`, and `OVERDUE` are derived presentation states, not persisted states:

- `PAID` when issued and active payment sum equals total.
- `PARTIALLY_PAID` when issued and active payment sum is greater than zero and less than total.
- `OVERDUE` when issued, balance is positive, and organization-local current date is after `dueDate`.
- Otherwise display `ISSUED`. An invoice may be both partially paid and overdue; APIs expose `paymentState` and `isOverdue` separately to avoid a lossy single status.

### Invoice fields and rules

- Belongs to one organization and one customer from the same organization.
- Has issue date, due date, organization base currency, optional purchase-order reference, notes, terms, and server snapshots of customer billing details.
- Has one or more line items containing description, positive quantity, non-negative unit price, and stable display order.
- MVP supports an invoice-level discount (`NONE`, fixed amount, or percentage) and one invoice-level tax percentage applied after discount. Line-level tax/discount combinations are deferred.
- Server computes subtotal, discount amount, taxable amount, tax amount, and total using the Money rules below. Client-supplied totals are rejected.
- Due date cannot precede issue date. Dates may be backdated only for permitted finance users and within a configurable/reviewed policy.
- Drafts may be updated or hard-deleted if never issued, with an audit event. Issued invoices cannot be deleted and financial terms cannot be edited; correction uses cancel/void and replacement. Non-financial delivery metadata may change only through explicitly audited operations.
- Issue assigns the next number and financial snapshot atomically. Numbers are unique per organization, gap-tolerant, never reused, and generated using a locked sequence row.

### Invoice numbering

Format is organization-configurable prefix plus monotonically increasing integer, e.g. `INV-000123`. The database stores the rendered `invoiceNumber` and numeric sequence value. Uniqueness is `(organizationId, invoiceNumber)` and preferably `(organizationId, sequenceValue)`. Gaps caused by rolled-back or voided operations are acceptable; legal gapless numbering is not promised.

### Important failures

Reject an empty invoice, invalid customer, cross-tenant customer, invalid decimal precision, negative price, non-positive quantity, excessive discount, unsupported tax rate, issue without required fields, edits after issue, cancellation with active payments, or duplicate invoice number. Concurrent issue requests are serialized by the sequence mechanism.

## 9. Payments

### Lifecycle and model

In MVP, one payment applies to exactly one invoice. A payment records organization, invoice, amount, currency, business payment date, method (`CASH`, `BANK_TRANSFER`, `UPI`, `CARD_EXTERNAL`, `CHEQUE`, `OTHER`), optional external reference, notes, recorder, and status `RECORDED` or `REVERSED`.

- Amount is positive, uses organization currency precision, and cannot exceed the invoice's current outstanding balance.
- The invoice must be `ISSUED`; cancelled/void/draft invoices reject payments.
- Partial payments are allowed. Multiple payments may settle an invoice.
- Payment rows are immutable after recording. Correction creates a reversal action that changes original status to `REVERSED` and creates a linked reversal record/event with reason, actor, and timestamp; corrected value is a new payment.
- Reversal reopens the invoice automatically through derived balance. It is forbidden if it would violate a later dependent business rule; MVP has no refunds or downstream allocations, so this is straightforward.
- `Idempotency-Key` is required for payment creation and public payment reversal. The key is unique per organization, operation, and caller scope, and repeated identical requests return the prior result; a changed payload yields `409`.
- Concurrent payments lock the invoice row, recompute active payment sum inside the transaction, validate remaining balance, insert payment, update cached amount-paid/balance if used, and commit.
- Multiple-invoice allocation, overpayments, unapplied credits, refunds, and gateway settlement are later scope.

### Balance

The authoritative balance equation is `invoice total - sum(RECORDED payments)`. For fast reads, `amountPaid` and `balanceDue` are stored on the invoice as transactionally maintained cached values and checked against payments. Reconciliation tests/jobs can detect drift; analytics may recompute from source rows for verification.

## 10. Expenses

An expense belongs to one organization and has category, positive amount, base currency, date, description, optional vendor/payee, reference, notes, and status `ACTIVE` or `VOIDED`. Categories are organization-owned records seeded with common defaults; a referenced category is archived rather than deleted.

Active expenses count as cash outflow on `expenseDate`. MVP assumes an expense record represents cash paid, not a bill payable; unpaid bills/accounts payable are later scope. MVP has no accounting-period/reporting lock: an ACTIVE expense may be edited with optimistic concurrency and audit, while a VOIDED expense is immutable. Safer finance practice is to void and replace material errors. The normal API does not hard-delete expenses.

Attachments/receipts, recurring expenses, approval workflows, tax reclaim, and accruals are later.

## 11. Money and financial definitions

### Decision: representation and currency

Use PostgreSQL `NUMERIC`, Prisma `Decimal`, and a central decimal calculation library/service. Money is never converted to JavaScript `number`. API monetary values are decimal strings. Amount columns use a conservative logical precision such as `NUMERIC(19,4)`; the calculation engine validates the currency's allowed minor-unit scale (usually 2) and rounds only at documented boundaries using round-half-away-from-zero. Quantities use higher scale such as `NUMERIC(19,6)`.

Each organization has one immutable base currency after financial activity. Every financial row still stores the currency code defensively. Per-invoice or true multi-currency is deferred because it requires exchange rates and accounting policies.

Alternatives rejected: integer minor units complicate currencies and fractional unit-price calculations; floating point is financially unsafe; arbitrary per-invoice currency without FX makes aggregates misleading.

### Authoritative versus derived values

| Value | Strategy |
|---|---|
| Quantity, unit price, configured discount/tax inputs | Authoritative inputs stored |
| Line net, invoice subtotal/discount/tax/total | Server-calculated and stored as finalized snapshot; recomputed/validated on draft mutation |
| Active payment records | Authoritative cash-in source |
| Invoice amount paid/balance | Transactionally maintained cache; authoritative equation reconciles against active payments |
| Expense amount/status | Authoritative cash-out source |
| Cash flow, P&L, analytics totals | Query-derived from source records; no mutable aggregate table in MVP |

### Calculation order

1. Validate quantity and unit price precision.
2. Calculate each line raw amount `quantity × unitPrice`; round each line to currency scale.
3. Sum rounded lines for subtotal.
4. Calculate fixed discount or percentage of subtotal; round; require `0 <= discount <= subtotal`.
5. Taxable amount is `subtotal - discount`.
6. Calculate invoice-level tax percentage on taxable amount; round.
7. Total is `taxable amount + tax`; require total non-negative and below configured maximum.

Tax-inclusive pricing, compound taxes, withholding, and jurisdiction-specific rounding are not supported in MVP and must be clearly disclosed.

### Cash flow

- Cash inflow: active recorded payment amount on `paymentDate`, not invoice issue.
- Cash outflow: active expense amount on `expenseDate` because MVP expenses mean paid expenses.
- Net cash flow: inflow minus outflow for an inclusive organization-local business-date range.
- Unpaid invoices do not affect actual cash flow; they appear in receivables and may support a clearly labeled future forecast.
- Reversed payments and voided expenses are excluded.

### Profit & Loss

MVP P&L is a **simplified cash-basis management statement**: collected invoice payments minus paid active expenses in the period. It is not GAAP/IFRS net income; it lacks cost capitalization, depreciation, inventory, accounts payable, journal entries, tax accounting, and allocation rules. The API/report must label it “Cash-basis performance” or disclose this limitation.

An accrual-like invoice-issued view may be added later but must not be labeled compliant P&L without a ledger.

### Analytics

- Total invoiced: issued, non-cancelled/non-void invoice totals by issue date.
- Total collected: active payments by payment date.
- Outstanding receivables: positive balances on issued invoices as of current data; historical as-of balances require payment/reversal timestamps and explicit query logic.
- Overdue amount: outstanding balance where due date precedes organization-local as-of date.
- Total expenses: active expense amounts by expense date.
- Net cash flow/cash-basis performance: collected minus expenses.
- Collection rate: collected applicable to selected invoices divided by their totals; the API must define cohort semantics rather than mixing date bases. MVP default is invoices issued in range and payments allocated to those invoices through `asOf`.
- Average payment delay: for fully paid invoices, days from due date to final settlement date; negative values mean early. Clearly identify sample size.

## 12. Notifications and reminders

MVP notification types are invoice upcoming due, invoice overdue, payment recorded, report ready, and job failed/admin action when useful. An in-app notification record is the durable user-facing state; email is delivered through a pluggable provider and may be enabled after templates/consent are reviewed.

Scheduled daily jobs scan tenant-local due dates. Reminder policies include enabled flag, days-before-due, and overdue cadence with conservative defaults. Jobs must be idempotent using a key such as `(organizationId, invoiceId, reminderType, effectiveDate, channel)`. Cancelled, void, or zero-balance invoices are suppressed. Retries use exponential backoff with bounded attempts; exhausted deliveries enter a failed-job view/dead-letter strategy and create operational alerts.

## 13. Reports

MVP reports:

- Invoice register with lifecycle, customer, dates, totals, paid, balance, overdue flag.
- Outstanding receivables and aging buckets.
- Payments register.
- Expenses by date/category/vendor.
- Cash-flow summary and time series.
- Simplified cash-basis performance statement.

CSV is first because it is auditable, portable, and simpler than layout-sensitive PDF. Small results stream synchronously with safe CSV escaping; large exports create a tenant-scoped `ReportExport`, run in BullMQ, write to private object storage in a later deployment integration, and return a short-lived authorized download. Every request rechecks export organization and permission. PDF is later.

## 14. Audit requirements

Audit organization settings/lifecycle, membership invitation/status/role and ownership changes, customer archival, invoice create/update/issue/cancel/void, payment record/reversal, expense create/update/void, report export, authentication security events, and permission-sensitive operations.

Each entry records organization (nullable only for global auth events), actor user/session or system worker, action, entity type/ID, result, timestamp, correlation/request ID, source IP/user agent where justified, and small allowlisted before/after metadata. It never stores passwords, hashes, raw tokens, secrets, complete request bodies, card data, or unnecessary PII. Normal application roles cannot update/delete audit rows.

## 15. Non-functional requirements

- **Correctness:** all money uses decimal arithmetic; database transactions preserve stated invariants; UTC/business-date semantics are explicit.
- **Security:** OWASP-aligned validation, authorization on every tenant operation, Argon2id, refresh rotation, rate limits, secure headers, restrictive CORS, parameterized ORM queries, least-privilege credentials, secret injection, and safe logs.
- **Availability:** health/readiness endpoints distinguish process, PostgreSQL, and Redis health; financial writes remain available if Redis is unavailable except nonessential asynchronous features.
- **Performance:** typical tenant list APIs use indexed cursor pagination and bounded page size; no unbounded exports; common reads target sub-second server processing under expected MVP load, verified later with representative data.
- **Reliability:** jobs are at-least-once and idempotent; financial mutations remain synchronous; retries cannot duplicate side effects.
- **Observability:** structured logs with correlation, organization, user, route, duration, and safe error code; job metrics, queue depth, retries, database latency, auth failures, and financial reconciliation failures.
- **Privacy:** collect minimum PII, redact logs, authorize exports, define retention/deletion policy before public launch.
- **Maintainability:** strict TypeScript, module boundaries, lint/format checks, migrations reviewed, and tests required in CI.

## 16. Financial business-rule catalogue

| Rule | Owner | Error | Transaction | Minimum tests |
|---|---|---|:---:|---|
| Quantity must be positive and within precision/max | Invoices | `422 INVALID_QUANTITY` | Draft write transaction | zero, negative, scale, max |
| Unit price is non-negative; totals are server-calculated | Invoices/Money | `422 INVALID_MONEY` | Yes with invoice write | spoofed total ignored/rejected, rounding |
| Discount cannot exceed subtotal; tax rate is bounded | Invoices/Money | `422 INVALID_DISCOUNT/TAX` | Yes | fixed/percent boundaries |
| Due date is not before issue date | Invoices | `422 INVALID_DATE_RANGE` | Yes | equal and reversed dates |
| Issue requires complete draft and atomically assigns unique number | Invoices | `409/422` | Yes | concurrent issue, retry, rollback |
| Issued financial terms are immutable | Invoices | `409 INVOICE_FINALIZED` | Yes | every forbidden field |
| Issued invoice cannot be deleted | Invoices | `409` | No/Yes for state transition | draft delete vs issued |
| Payment is positive, same currency, and no greater than locked balance | Payments | `422 PAYMENT_EXCEEDS_BALANCE` | Yes | partial/full/overpay/concurrent |
| Payment create is idempotent | Payments/Idempotency | `409 IDEMPOTENCY_CONFLICT` | Yes | same key/same body and changed body |
| Recorded payments are immutable; correction is reversal plus replacement | Payments | `409 PAYMENT_IMMUTABLE` | Yes | reversal reopens balance, double reversal |
| Invoice cancellation/void requires zero active payments | Invoices | `409 ACTIVE_PAYMENTS_EXIST` | Yes | payment present/reversed |
| Overdue is derived from due date, positive balance, and tenant-local date | Analytics/Invoices | n/a | No | timezones, paid, due today |
| Expense amount is positive and base currency | Expenses | `422 INVALID_MONEY` | Yes with audit | amount/scale/currency |
| Voided expenses and reversed payments do not count in reports | Analytics | n/a | No | inclusion/exclusion across ranges |
| Invoice numbers are unique per tenant and never reused | Invoices | `409` on exceptional conflict | Yes | parallel tenants and parallel issue |

## 17. Major feature acceptance criteria

### Authentication

- Correct credentials create a session and token pair; incorrect credentials disclose no account existence.
- Refresh rotation invalidates the consumed token, detects replay, and logout revokes access via session policy.
- Disabled users and revoked sessions cannot refresh or perform protected requests.

### Tenant and RBAC

- A multi-organization user can select each active membership independently.
- No request body/path manipulation permits a user to read or mutate another tenant.
- Every matrix denial is covered by policy/API tests, including Admin inability to alter Owner.
- Ownership transfer is atomic and never leaves zero or two active owners.

### Customers and invoices

- Customer operations are tenant-scoped; archived customers remain on historic invoices.
- Server totals match the specified rounding order for boundary cases.
- Issue freezes financial fields and assigns a concurrency-safe tenant number.
- Derived payment state and overdue flag are correct without a scheduled status update.

### Payments and expenses

- Partial/full payments update cached balance atomically and reconcile to active payments.
- Two concurrent payments cannot overpay an invoice.
- Duplicate idempotent retries have one financial effect.
- Reversal and expense void immediately affect reports and create audit records.

### Reporting and jobs

- Every metric reconciles to source rows under documented date and status rules.
- Date boundaries respect organization timezone and inclusive business dates.
- Reminder retries do not produce duplicate notifications and suppress ineligible invoices.
- Cross-tenant exports and guessed export IDs return `404`.

## 18. Architectural decision records

| Decision | Rationale | Alternatives | Consequences |
|---|---|---|---|
| Modular monolith | One deployable and transaction boundary suits one developer and connected finance domains | Microservices | Strong module discipline required; future extraction remains possible |
| Shared DB, tenant-scoped rows | Operationally simple and economical | DB/schema per tenant | Every query/constraint/index must carry tenant context |
| No RLS initially | Prisma transaction/request context and migrations stay simpler | PostgreSQL RLS | Application repositories, service policies, tests, and reviews must enforce isolation; revisit before higher-risk scale |
| Code-defined role-to-permission map | Reviewable and simple | DB custom roles | Role changes require deployment; custom roles deferred |
| `NUMERIC` + Prisma Decimal | Correct decimal arithmetic and fractional pricing | JS number; integer minor units | Decimal serialization/utilities are mandatory |
| One base currency per organization | Aggregates remain meaningful without FX | Per-invoice/true multi-currency | Currency locks after first financial record |
| Number at issue from tenant sequence | Draft churn creates no numbers; concurrency is controllable | UUID/display ID; global sequence | Gaps allowed; issue transaction locks sequence |
| Cash-basis cash flow and simplified P&L | Matches recorded payments/paid expenses and MVP data | Accrual/full ledger | Must be labeled non-GAAP/IFRS |
| One payment to one invoice | Simple invariants and reversal | Payment allocations | Split remittances deferred |
| Stored finalized totals and cached balance | Stable invoice snapshot and fast reads | Fully compute on demand | Transactional maintenance plus reconciliation required |
| Issued invoices immutable | Auditability | In-place edits | Corrections require void/cancel and replacement |
| Financial mutations use PostgreSQL transactions | Preserve cross-row invariants | Eventual consistency | Short transactions and lock ordering required |
| BullMQ only for asynchronous side effects | Financial truth remains synchronous | Queue all commands | Jobs must be idempotent and tenant-scoped |
| Selective soft lifecycle states | Preserve referenced/audited finance data | Universal soft delete/hard delete | Every query has explicit active/status semantics |

## 19. Explicit assumptions requiring product review

1. The system records externally received payments; it does not move money.
2. One organization uses one base currency and one IANA timezone.
3. An expense represents cash already paid.
4. Invoice-level exclusive tax and discount are sufficient for MVP.
5. Issued invoices are immutable; credit notes are not available in MVP.
6. Overpayments and multi-invoice payments are rejected.
7. Cash-basis performance is acceptable if clearly labeled as simplified management reporting.
8. One Owner is sufficient; ownership transfer is required before Owner removal.
9. CSV precedes PDF; email reminders may be provider-gated.
10. Historical “as-of” receivables are based on immutable event timestamps/status history retained by payments and reversals.

## 20. Unresolved product decisions

- Jurisdictions and exact tax display/legal invoice requirements.
- Maximum backdating window and whether period locks are required.
- Whether invoice cancellation and void need separate user-visible meanings; recommended baseline is cancel before delivery/payment, void for invalid issued document.
- Whether invoice numbers need fiscal-year prefixes/reset; recommended MVP is never-reset tenant sequence.
- Invitation/email verification inclusion before portfolio demo versus before public launch.
- Retention periods, data export/deletion process, and applicable privacy law.
- Reminder recipients, consent, cadence, quiet hours, and email provider.
- Limits by subscription plan, maximum amounts, rows, file size, and report span.
- Whether Members may issue invoices; baseline says yes, but this should be confirmed.
- Whether Viewer may see all financial analytics; baseline says yes.
