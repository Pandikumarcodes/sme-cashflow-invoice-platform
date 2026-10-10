# SME Cash Flow & Invoice Management System — API Inventory

This is the maintained inventory of the HTTP API surface. Implemented routes are
verified against controllers in `src/`; planned routes come from
`docs/api-contracts.md` and are explicitly labelled.

## 1. API Summary

- Current implemented APIs: **64**
- Estimated final APIs: **65–70**
- Estimated remaining APIs: **1–6**
- Current milestone: **Prompt 21 Reports / Export**
- Verification: Prompt 21 passes 44 unit suites/290 tests, 14 PostgreSQL suites/128
  tests, 13 E2E suites/69 tests, 3 queue suites/8 tests, and a 213-file build.
  Formatting, lint, Prisma validation and diff checks pass.
- Base path: `/api/v1`
- Authentication: Bearer access token plus HttpOnly refresh cookie
- Backend deployment: Local development only

The estimate is based on the current API-contract route map. It is not a
commitment that every planned route will remain separate.

Prompt 12 introduced trusted tenant context and explicit Prisma query helpers
with **zero new HTTP APIs**, retaining 23 APIs at that milestone. Prompt 13 uses
that infrastructure and adds **five Customer APIs**, bringing the count to **28**.
Prompt 14 added **eight Invoice APIs**, bringing the count to **36**.
Prompt 15 adds **four Payment APIs**, bringing the count to **40**.
Prompt 16 adds **four Category and five Expense APIs**, bringing the count to **49**.
Prompt 17 adds **one Cash Flow API**, bringing the count to **50**.
Prompt 18 adds **one Profit & Loss API**, bringing the count to **51**.
Prompt 19 adds **two Financial Analytics APIs**, bringing the current count to **53**.
Prompt 20 adds **three Notification APIs**, bringing the current count to **56**.
Prompt 21 adds **eight Report/Export APIs**, bringing the current count to **64**.

---

## 2. API Count by Module

| Module | Implemented APIs | Planned APIs | Status |
|---|---:|---:|---|
| Health | 2 | 0 | IMPLEMENTED |
| Auth | 6 | 0 | IMPLEMENTED |
| Organizations | 5 | 0 | IMPLEMENTED |
| Memberships / Invitations | 10 | 0 | IMPLEMENTED WITH CAVEAT |
| Customers | 5 | 0 | IMPLEMENTED |
| Invoices | 8 | 0 | IMPLEMENTED |
| Payments | 4 | 0 | IMPLEMENTED |
| Expenses | 9 | 0 | IMPLEMENTED |
| Cash Flow | 1 | 0 | IMPLEMENTED |
| P&L | 1 | 0 | IMPLEMENTED |
| Analytics | 2 | 0 | IMPLEMENTED |
| Notifications | 3 | 0 | IMPLEMENTED |
| Reports | 8 | 0 | IMPLEMENTED |
| Audit Logs | 0 | 1 | PLANNED — NOT IMPLEMENTED |
| **Total** | **64** | **1** | **Estimated final baseline: 65** |

The final range allows for planned API consolidation or additions. A planned
count does not indicate that a database model or service exists.

---

## 3. Complete Implemented API List

| # | Method | Endpoint | Module | Auth | Permission | What It Does | Used By |
|---:|---|---|---|---|---|---|---|
| 1 | GET | `/api/v1/health/live` | Health | Public | — | Reports process liveness | Health monitoring |
| 2 | GET | `/api/v1/health/ready` | Health | Public | — | Checks PostgreSQL and Redis readiness | Health monitoring |
| 3 | POST | `/api/v1/auth/register` | Auth | Public | — | Creates a global user | Future frontend: Register page |
| 4 | POST | `/api/v1/auth/login` | Auth | Public | — | Creates a session and returns access credentials | Future frontend: Login page |
| 5 | POST | `/api/v1/auth/refresh` | Auth | Refresh cookie | — | Rotates refresh credential and returns access token | Future frontend: session renewal |
| 6 | POST | `/api/v1/auth/logout` | Auth | Bearer or refresh cookie | — | Revokes the current session | Future frontend: logout control |
| 7 | POST | `/api/v1/auth/logout-all` | Auth | Bearer | — | Revokes all active user sessions | Future frontend: security settings |
| 8 | GET | `/api/v1/me` | Auth | Bearer | — | Returns safe current-user profile | Future frontend: authenticated app shell |
| 9 | POST | `/api/v1/organizations` | Organizations | Bearer | Authenticated user | Creates organization and tenant roots | Future frontend: organization creation |
| 10 | GET | `/api/v1/organizations` | Organizations | Bearer | — | Lists caller's active organizations | Future frontend: organization selector |
| 11 | GET | `/api/v1/organizations/:organizationId` | Organizations | Bearer + active membership | `organization.read` | Returns organization details | Future frontend: organization settings |
| 12 | PATCH | `/api/v1/organizations/:organizationId` | Organizations | Bearer + active membership | `organization.update` | Updates allowed settings using `If-Match` | Future frontend: organization settings |
| 13 | POST | `/api/v1/organizations/:organizationId/close` | Organizations | Bearer + active membership | `organization.close` | Closes organization without deleting history | Future frontend: organization settings |
| 14 | GET | `/api/v1/organizations/:organizationId/members` | Memberships | Bearer + active membership | `membership.read` | Lists organization members | Future frontend: Members page |
| 15 | POST | `/api/v1/organizations/:organizationId/invitations` | Invitations | Bearer + active membership | `membership.invite` | Creates email-bound invitation | Future frontend: invitation flow |
| 16 | GET | `/api/v1/organizations/:organizationId/invitations` | Invitations | Bearer + active membership | `membership.read` | Lists invitations | Future frontend: Members page |
| 17 | DELETE | `/api/v1/organizations/:organizationId/invitations/:invitationId` | Invitations | Bearer + active membership | `membership.invite` | Revokes invitation | Future frontend: Members page |
| 18 | POST | `/api/v1/invitations/accept` | Invitations | Bearer + invitation token | — | Accepts matching email-bound invitation | Future frontend: invitation acceptance |
| 19 | PATCH | `/api/v1/organizations/:organizationId/members/:membershipId` | Memberships | Bearer + active membership | `membership.change_role` | Changes a non-Owner role using `If-Match` | Future frontend: Members page |
| 20 | POST | `/api/v1/organizations/:organizationId/members/:membershipId/suspend` | Memberships | Bearer + active membership | `membership.suspend` | Suspends a membership using `If-Match` | Future frontend: Members page |
| 21 | POST | `/api/v1/organizations/:organizationId/members/:membershipId/reactivate` | Memberships | Bearer + active membership | `membership.suspend` | Reactivates retained membership using `If-Match` | Future frontend: Members page |
| 22 | DELETE | `/api/v1/organizations/:organizationId/members/:membershipId` | Memberships | Bearer + active membership | `membership.remove` | Marks membership as removed using `If-Match` | Future frontend: Members page |
| 23 | POST | `/api/v1/organizations/:organizationId/transfer-ownership` | Memberships | Bearer + recent authentication | `organization.transfer_ownership` | Atomically transfers Owner role | Future frontend: organization settings |
| 24 | POST | `/api/v1/organizations/:organizationId/customers` | Customers | Bearer + active membership | `customer.create` | Creates customer with audit | Future frontend: Customers |
| 25 | GET | `/api/v1/organizations/:organizationId/customers` | Customers | Bearer + active membership | `customer.read` | Lists/searches customers with cursor pagination | Future frontend: Customers |
| 26 | GET | `/api/v1/organizations/:organizationId/customers/:customerId` | Customers | Bearer + active membership | `customer.read` | Reads active or archived customer | Future frontend: Customer Details |
| 27 | PATCH | `/api/v1/organizations/:organizationId/customers/:customerId` | Customers | Bearer + active membership | `customer.update` | Corrects customer fields using `If-Match` | Future frontend: Customer Details |
| 28 | POST | `/api/v1/organizations/:organizationId/customers/:customerId/archive` | Customers | Bearer + active membership | `customer.archive` | Idempotently archives customer with audit | Future frontend: Customer Details |
| 29 | POST | `/api/v1/organizations/:organizationId/invoices` | Invoices | Bearer + active membership | `invoice.create` | Create draft invoice | Future frontend: Invoices |
| 30 | GET | `/api/v1/organizations/:organizationId/invoices` | Invoices | Bearer + active membership | `invoice.read` | List/search invoices | Future frontend: Invoices |
| 31 | GET | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Invoices | Bearer + active membership | `invoice.read` | Get invoice details | Future frontend: Invoice Details |
| 32 | PATCH | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Invoices | Bearer + active membership | `invoice.update_draft` | Update draft invoice | Future frontend: Invoice Details |
| 33 | DELETE | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Invoices | Bearer + active membership | `invoice.delete_draft` | Delete draft invoice | Future frontend: Invoice Details |
| 34 | POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/issue` | Invoices | Bearer + active membership | `invoice.issue` | Issue and number invoice | Future frontend: Invoice Details |
| 35 | POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/cancel` | Invoices | Bearer + active membership | `invoice.cancel` | Cancel issued invoice without payment history | Future frontend: Invoice Details |
| 36 | POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/void` | Invoices | Bearer + active membership | `invoice.void` | Void issued invoice without active payments | Future frontend: Invoice Details |
| 37 | POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/payments` | Payments | Bearer + active membership | `payment.create` | Record payment with idempotency | Future frontend: Invoice Details |
| 38 | GET | `/api/v1/organizations/:organizationId/payments` | Payments | Bearer + active membership | `payment.read` | List/filter payments | Future frontend: Payments |
| 39 | GET | `/api/v1/organizations/:organizationId/payments/:paymentId` | Payments | Bearer + active membership | `payment.read` | Get payment and reversal | Future frontend: Payments |
| 40 | POST | `/api/v1/organizations/:organizationId/payments/:paymentId/reverse` | Payments | Bearer + active membership | `payment.reverse` | Reverse payment in full with idempotency | Future frontend: Payments |
| 41 | GET | `/api/v1/organizations/:organizationId/expense-categories` | Expenses | Bearer + active membership | `expense.read` | List categories | Future frontend: Expenses |
| 42 | POST | `/api/v1/organizations/:organizationId/expense-categories` | Expenses | Bearer + active membership | `expense_category.manage` | Create category | Future frontend: Expenses |
| 43 | PATCH | `/api/v1/organizations/:organizationId/expense-categories/:categoryId` | Expenses | Bearer + active membership | `expense_category.manage` | Update category | Future frontend: Expenses |
| 44 | POST | `/api/v1/organizations/:organizationId/expense-categories/:categoryId/archive` | Expenses | Bearer + active membership | `expense_category.manage` | Archive category | Future frontend: Expenses |
| 45 | POST | `/api/v1/organizations/:organizationId/expenses` | Expenses | Bearer + active membership | `expense.create` | Create expense | Future frontend: Expenses |
| 46 | GET | `/api/v1/organizations/:organizationId/expenses` | Expenses | Bearer + active membership | `expense.read` | List expenses | Future frontend: Expenses |
| 47 | GET | `/api/v1/organizations/:organizationId/expenses/:expenseId` | Expenses | Bearer + active membership | `expense.read` | Read expense | Future frontend: Expenses |
| 48 | PATCH | `/api/v1/organizations/:organizationId/expenses/:expenseId` | Expenses | Bearer + active membership | `expense.update` | Update expense using If-Match | Future frontend: Expenses |
| 49 | POST | `/api/v1/organizations/:organizationId/expenses/:expenseId/void` | Expenses | Bearer + active membership | `expense.void` | Void expense using If-Match | Future frontend: Expenses |
| 50 | GET | `/api/v1/organizations/:organizationId/cash-flow` | Cash Flow | Bearer + active membership | `analytics.read` | Derived cash inflow/outflow/net and chronological series | Future frontend: Cash Flow |
| 51 | GET | `/api/v1/organizations/:organizationId/profit-loss` | P&L | Bearer + active membership | `analytics.read` | Simplified cash-basis performance and category totals | Future frontend: Profit & Loss |
| 52 | GET | `/api/v1/organizations/:organizationId/analytics/summary` | Analytics | Bearer + active membership | `analytics.read` | Financial dashboard with explicit issue/payment/as-of cohorts | Future frontend: Dashboard |
| 53 | GET | `/api/v1/organizations/:organizationId/analytics/receivables-aging` | Analytics | Bearer + active membership | `analytics.read` | Source-derived positive receivables in five overdue buckets | Future frontend: Analytics |
| 54 | GET | `/api/v1/organizations/:organizationId/notifications` | Notifications | Bearer + active membership + recipient | `notification.read` | Cursor-paginated own inbox | Future frontend: Notifications |
| 55 | POST | `/api/v1/organizations/:organizationId/notifications/:notificationId/read` | Notifications | Bearer + active membership + recipient | `notification.update_self` | Idempotently mark own notification read | Future frontend: Notifications |
| 56 | POST | `/api/v1/organizations/:organizationId/notifications/:notificationId/archive` | Notifications | Bearer + active membership + recipient | `notification.update_self` | Idempotently archive own notification | Future frontend: Notifications |

| 57 | GET | `/api/v1/organizations/:organizationId/reports/invoices` | Reports | Bearer + active membership | `report.read` | Invoice register preview | Future frontend: Reports |
| 58 | GET | `/api/v1/organizations/:organizationId/reports/payments` | Reports | Bearer + active membership | `report.read` | Recorded payment preview | Future frontend: Reports |
| 59 | GET | `/api/v1/organizations/:organizationId/reports/expenses` | Reports | Bearer + active membership | `report.read` | Active expense preview | Future frontend: Reports |
| 60 | GET | `/api/v1/organizations/:organizationId/reports/receivables` | Reports | Bearer + active membership | `report.read` | Canonical aging preview | Future frontend: Reports |
| 61 | POST | `/api/v1/organizations/:organizationId/reports/exports` | Reports | Bearer + active membership | `report.export` | Durable asynchronous CSV request | Future frontend: Reports |
| 62 | GET | `/api/v1/organizations/:organizationId/report-exports` | Reports | Bearer + active membership | `report.export` | Cursor-paginated exports | Future frontend: Reports |
| 63 | GET | `/api/v1/organizations/:organizationId/report-exports/:exportId` | Reports | Bearer + active membership | `report.export` | Safe export metadata/state | Future frontend: Reports |
| 64 | GET | `/api/v1/organizations/:organizationId/report-exports/:exportId/download` | Reports | Bearer + active membership | `report.export` | Authorized audited CSV stream | Future frontend: Reports |

**TOTAL IMPLEMENTED APIs: 64**

---

## 4. API Details by Module

The details below describe the current registered routes, not the planned API
contract. All normal responses use a `{ data: ... }` envelope except health
responses and `204 No Content` commands.

### Health

#### GET /api/v1/health/live

Purpose: reports whether the HTTP process is alive.  
Used when: a health platform probes the API.  
Authentication: Public.  
Input/output: no input; returns `{ status: "ok" }`.  
Database models used: none.  
Redis/BullMQ: neither.  
Frontend/deployment usage: health platform; backend infrastructure.

#### GET /api/v1/health/ready

Purpose: reports whether PostgreSQL and Redis are reachable.  
Used when: a health platform checks readiness.  
Authentication: Public.  
Input/output: no input; returns `{ status: "ok" }` or safe `503`.  
Database models used: none; executes a Prisma readiness query.  
Redis/BullMQ: Redis `PING`; BullMQ is not queried.  
Frontend/deployment usage: health platform; backend infrastructure.

### Auth

#### POST /api/v1/auth/register

Purpose: creates a global user only.  
Used when: a person opens an account before joining or creating an organization.  
Authentication: Public; Redis rate-limited.  
Input/output: email, password, first name, last name; returns safe user.  
Database models used: `User`, `AuditLog`.  
Redis/BullMQ: Redis registration rate limit; no BullMQ.  
Frontend/deployment usage: Future frontend: Register page; browser API.

#### POST /api/v1/auth/login

Purpose: verifies credentials and creates a session family.  
Used when: a registered user signs in.  
Authentication: Public; Redis rate-limited.  
Input/output: email and password; returns access token/user and sets refresh cookie.  
Database models used: `User`, `RefreshSession`, `RefreshToken`, `AuditLog`.  
Redis/BullMQ: Redis login rate limit; no BullMQ.  
Frontend/deployment usage: Future frontend: Login page; browser API.

#### POST /api/v1/auth/refresh

Purpose: performs single-use refresh-token rotation.  
Used when: the access token expires or is about to expire.  
Authentication: refresh cookie; Redis rate-limited.  
Input/output: empty body; returns new access token and replacement cookie.  
Database models used: `RefreshSession`, `RefreshToken`, `User`, `AuditLog` on replay.  
Redis/BullMQ: Redis refresh rate limit; no BullMQ.  
Frontend/deployment usage: Future frontend: session renewal; browser API.

#### POST /api/v1/auth/logout

Purpose: revokes the session identified by bearer token or refresh cookie.  
Used when: a user signs out.  
Authentication: bearer token or refresh cookie; missing credentials are a no-op.  
Input/output: empty body; clears refresh cookie and returns `204`.  
Database models used: `RefreshSession`, `RefreshToken`, `AuditLog`.  
Redis/BullMQ: no Redis or BullMQ.  
Frontend/deployment usage: Future frontend: logout control; browser API.

#### POST /api/v1/auth/logout-all

Purpose: revokes every active session for the authenticated user.  
Used when: a user wants to end all active sessions.  
Authentication: Bearer.  
Input/output: empty body; clears current cookie and returns `204`.  
Database models used: `RefreshSession`, `RefreshToken`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: security settings; browser API.

#### GET /api/v1/me

Purpose: returns the safe profile for the current authenticated user.  
Used when: an authenticated application loads its user identity.  
Authentication: Bearer.  
Input/output: no input; returns safe `User` fields.  
Database models used: `User`, `RefreshSession` through access authentication.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: authenticated app shell; browser API.

### Organizations

#### POST /api/v1/organizations

Purpose: creates an organization and its required tenant roots atomically.  
Used when: an authenticated user creates their first or another organization.  
Authentication: Bearer.  
Input/output: allowed organization settings; returns organization and caller membership.  
Database models used: `Organization`, `Membership`, `InvoiceSequence`, `ExpenseCategory`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization creation; browser API.

#### GET /api/v1/organizations

Purpose: lists active organizations reached through the caller's active memberships.  
Used when: a user selects an organization.  
Authentication: Bearer.  
Input/output: no input; returns organization membership summaries.  
Database models used: `Organization`, `Membership`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization selector; browser API.

#### GET /api/v1/organizations/:organizationId

Purpose: returns an active organization available to the caller.  
Used when: organization information is loaded.  
Authentication: Bearer, active membership, `organization.read`.  
Input/output: UUID path parameter; returns organization and membership.  
Database models used: `Organization`, `Membership`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization settings; browser API.

#### PATCH /api/v1/organizations/:organizationId

Purpose: updates allowlisted organization settings.  
Used when: an Owner or Admin saves settings.  
Authentication: Bearer, active membership, `organization.update`.  
Input/output: `If-Match` and permitted settings; returns updated organization and `ETag`.  
Database models used: `Organization`, `Membership`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization settings; browser API.

#### POST /api/v1/organizations/:organizationId/close

Purpose: retains history while closing the organization.  
Used when: the Owner ends organization activity.  
Authentication: Bearer, active membership, `organization.close`.  
Input/output: closure reason; returns CLOSED organization.  
Database models used: `Organization`, `Membership`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization settings; browser API.

### Memberships / Invitations

#### GET /api/v1/organizations/:organizationId/members

Purpose: lists organization memberships.  
Used when: a manager views team access.  
Authentication: Bearer, active membership, `membership.read`.  
Input/output: UUID path and optional role/status filters; returns member summaries.  
Database models used: `Membership`, `User`, `Organization`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### POST /api/v1/organizations/:organizationId/invitations

Purpose: creates a PENDING invitation for a non-Owner role.  
Used when: Owner/Admin invites a person.  
Authentication: Bearer, active membership, `membership.invite`.  
Input/output: email, role, optional expiration; returns invitation.  
Database models used: `OrganizationInvitation`, `Membership`, `User`, `Organization`, `AuditLog`.  
Redis/BullMQ: neither; no email job exists.  
Frontend/deployment usage: Future frontend: invitation flow; browser API.

#### GET /api/v1/organizations/:organizationId/invitations

Purpose: lists scoped invitations and records expired pending invitations.  
Used when: a manager reviews invitations.  
Authentication: Bearer, active membership, `membership.read`.  
Input/output: UUID path and optional status filter; returns invitations.  
Database models used: `OrganizationInvitation`, `Membership`, `Organization`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### DELETE /api/v1/organizations/:organizationId/invitations/:invitationId

Purpose: revokes an available scoped invitation.  
Used when: a manager cancels an invitation.  
Authentication: Bearer, active membership, `membership.invite`.  
Input/output: UUID path parameters; returns `204`.  
Database models used: `OrganizationInvitation`, `Membership`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### POST /api/v1/invitations/accept

Purpose: consumes a valid invitation for the authenticated matching email.  
Used when: an invited user joins an organization.  
Authentication: Bearer plus invitation token in body.  
Input/output: token; returns membership and `ETag`.  
Database models used: `OrganizationInvitation`, `Membership`, `Organization`, `User`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: invitation acceptance; browser API.

#### PATCH /api/v1/organizations/:organizationId/members/:membershipId

Purpose: changes a non-Owner membership role.  
Used when: Owner/Admin adjusts team access.  
Authentication: Bearer, active membership, `membership.change_role`.  
Input/output: `If-Match` and role; returns membership and `ETag`.  
Database models used: `Membership`, `Organization`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### POST /api/v1/organizations/:organizationId/members/:membershipId/suspend

Purpose: changes ACTIVE membership to SUSPENDED.  
Used when: a manager temporarily removes access.  
Authentication: Bearer, active membership, `membership.suspend`.  
Input/output: `If-Match`; returns membership and `ETag`.  
Database models used: `Membership`, `Organization`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### POST /api/v1/organizations/:organizationId/members/:membershipId/reactivate

Purpose: restores a SUSPENDED or REMOVED membership.  
Used when: a manager restores access.  
Authentication: Bearer, active membership, `membership.suspend`.  
Input/output: `If-Match`; returns membership and `ETag`.  
Database models used: `Membership`, `Organization`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### DELETE /api/v1/organizations/:organizationId/members/:membershipId

Purpose: retains membership history while marking a member REMOVED.  
Used when: a manager removes member access.  
Authentication: Bearer, active membership, `membership.remove`.  
Input/output: `If-Match`; returns `204`.  
Database models used: `Membership`, `Organization`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: Members page; browser API.

#### POST /api/v1/organizations/:organizationId/transfer-ownership

Purpose: atomically promotes an active target member to Owner and demotes the prior Owner to Admin.  
Used when: an organization changes ownership.  
Authentication: Bearer, active membership, recent authentication, `organization.transfer_ownership`.  
Input/output: target membership ID; returns previous/current owner summaries.  
Database models used: `Organization`, `Membership`, `User`, `AuditLog`.  
Redis/BullMQ: neither.  
Frontend/deployment usage: Future frontend: organization settings; browser API.

### Customers

All five Customer routes require Bearer authentication, current active Membership
in an active Organization, and the permission listed above. They use `Customer`,
`Membership`, `Organization`, and (for writes) `AuditLog`; no Redis/BullMQ work
is performed. The frontend remains unimplemented.

- **POST collection:** creates a customer from required `displayName` and optional
  nullable `customerCode`/`email`; returns 201 Customer and ETag. Tenant, creator,
  status, version, IDs, and timestamps are server-owned. Duplicate code in the
  same tenant returns safe 409 `CUSTOMER_CODE_UNAVAILABLE`.
- **GET collection:** lists ACTIVE by default; supports `status`, literal
  case-insensitive display-name/email `search` (2–100 characters), `sortBy`
  (`displayName`, `createdAt`, `updatedAt`), `sortOrder`, `limit` (1–100,
  default 25), and opaque `after`. Returns `data` plus pagination `meta`.
  Cursor tenant/filter/sort changes return 400 `INVALID_CURSOR`.
- **GET item:** returns 200 Customer/ETag, including archived customers; foreign
  and missing IDs return the same concealed 404.
- **PATCH item:** updates only the three writable fields, requires at least one
  field and `If-Match`, returns 200 Customer/ETag, and audits atomically. Null
  clears code/email. Stale version returns 409 `CONCURRENT_MODIFICATION`.
- **POST archive:** accepts `{}`, returns 200 retained ARCHIVED Customer/ETag.
  The first transition increments version and audits atomically; repeated
  archival does neither. Code remains reserved. No delete or restore API exists.

Prompt 13 intentionally uses the existing minimal Prisma Customer model;
broader conceptual phone/type/address/tax/terms/notes fields are not accepted.

### Invoices

All eight routes use AccessAuthGuard, AuthorizationGuard, canonical permissions,
trusted context, current PostgreSQL membership, and scoped Invoice/Customer access.
Mutations own one transaction and mandatory audit. No Redis/BullMQ is involved.
Models: Invoice, InvoiceItem, InvoiceSequence, Customer, Organization, Membership,
AuditLog; issue additionally writes PendingEvent.

- **POST collection:** required customerId, issueDate, dueDate, discount, taxRate
  and 1–1,000 allowlisted items. Returns 201 full DRAFT/ETag with server totals,
  organization currency, null number; permanently locks currency atomically.
- **GET collection:** cursor page, default issueDate desc/25 rows; all documented
  status/paymentState/overdue/customer/date/search filters and five sorts.
  Nullable numbers sort last. Cursors bind tenant/filter/sort; list date spans
  are bounded to 1,825 days. Search is literal and case-insensitive.
- **GET item:** full details/ETag, frozen name/email after issue; foreign/missing
  IDs receive the same 404.
- **PATCH item:** nonempty subset of implemented writable fields, If-Match,
  DRAFT only, full item replacement when supplied; atomic recalculation/audit.
- **DELETE item:** If-Match, DRAFT only, removes items/header with retained audit,
  returns 204. Currency lock is permanent.
- **POST issue:** empty/absent body and If-Match; locks/reloads/recalculates,
  validates ACTIVE customer and positive total, locks sequence, renders current
  prefix plus zero-padded counter, snapshots customer, returns 200 ISSUED/ETag.
  Sequence increment, document, audit and PendingEvent commit together.
- **POST cancel/void:** reason required; ISSUED only. Cancel blocks all payment
  history; void blocks RECORDED payments. Returns retained 200 document/ETag
  and evidence; terminal repeats conflict.

Amounts are Decimal internally and strings externally; rounding is per currency,
half away from zero. Payment/overdue are derived. Optional document text/reference
and recommended invoice key replay remain deferred; version/state guards protect
issue retries. Prompt 15 adds the Payment settlement writer described below.

### Payments — IMPLEMENTED (Prompt 15)

All four routes (rows 37–40) require Bearer authentication, current ACTIVE
membership and canonical permission. OWNER, ADMIN and ACCOUNTANT are permitted;
MEMBER and VIEWER have no Payment permissions. Models: Payment, PaymentReversal,
Invoice, Organization, Membership, IdempotencyRecord, AuditLog and PendingEvent.
No Redis/BullMQ call or business worker is introduced.

- **Record:** required Idempotency-Key; body `{amount,paymentDate,method}`.
  Positive decimal string obeying currency minor units; real YYYY-MM-DD date;
  method CASH/BANK_TRANSFER/UPI/CHEQUE/CARD_EXTERNAL/OTHER. Returns 201 Payment
  with Invoice financial summary. Currency, actors and timestamps are server-owned.
- **List:** 200 `{data,meta:{limit,hasMore,nextCursor}}`; default 25/max 100,
  paymentDate desc. Filters invoiceId/status/method/paymentDateFrom/To; inclusive
  date span at most 1,825 days; sorts paymentDate/recordedAt/amount asc/desc.
  Cursors bind tenant/filter/sort and use id for ties. No nested invoice GET
  collection is registered.
- **Detail:** 200 Payment with current Invoice settlement and nullable full
  reversal detail, including server actors/timestamps.
- **Reverse:** required key; `{reason,reversalDate}`, full-only. Returns 200
  retained REVERSED Payment plus recalculated Invoice. A fresh key after reversal
  yields 409 PAYMENT_ALREADY_REVERSED. No PATCH/DELETE Payment exists.
- **Financial safety:** ISSUED only; Invoice then Payment lock order. All writers
  share the Invoice lock; RECORDED sums maintain paid/balance caches and increment
  version atomically. Overpayment returns 422 PAYMENT_EXCEEDS_BALANCE with
  currency/remainingBalance. Drift returns 409 INVOICE_SETTLEMENT_INCONSISTENT.
- **Idempotency:** organization/User/operation/key scope; hash includes normalized
  amount, currency, resource, date and method/reason. Original status/body is
  replayed with Idempotency-Replayed: true, even after later settlement or void.
  Changed intent yields 409 IDEMPOTENCY_CONFLICT. References/status and immutable
  audit financial receipts preserve the original result; no response blob is
  stored on the claim. Retention is at least 30 days; no cleanup job exists.
- **Atomic side effects:** PAYMENT_RECORDED / PAYMENT_REVERSED audit and versioned
  ID-only PendingEvent commit with mutation and claim completion.
- **Deferred:** reference/notes/reference search are absent from the schema and
  rejected. Unknown/server-owned input is rejected. Foreign/missing resources
  are concealed as 404. No processor, refund or reconciliation engine exists.

### Expenses — IMPLEMENTED (Prompt 16)

Rows 41–49 implement exactly four Category and five Expense routes. Categories
accept name and optional description; names trim, collapse whitespace and
lowercase without Unicode normalization. Names are tenant-unique, including
archived names. Category PATCH requires ACTIVE; systemKey is immutable. Defaults
remain seeded by Organizations and may archive. Archive repeats return the same
resource without another write/audit. Categories have no resource version/ETag.

OWNER, ADMIN and ACCOUNTANT have all five canonical Expense permissions. VIEWER
has expense.read only; MEMBER has no Expense permission. Every route authenticates
and resolves current PostgreSQL Membership, and mutation services reauthorize
using their transaction client. Role/status changes apply to the same JWT.

Expenses accept categoryId, amount, expenseDate, description and optional nullable
vendorPayee/reference/notes. Amounts are positive Decimal strings, obey currency
minor units without rounding, and serialize at the currency scale. First Expense
creation permanently locks Organization currency in the same transaction.
New assignments require a locked ACTIVE category in the same tenant; unchanged
archived references remain editable and visible in category summaries.
PATCH/void require If-Match, increment version once and return an ETag. VOIDED
is immutable; a fresh repeat void conflicts. Actors and void evidence are server-owned.

Lists use default 25/max 100, bound after cursors and id ties. Categories default
ACTIVE/name asc. Expenses default ACTIVE/expenseDate desc; filters categoryId,
status, expenseDateFrom/To and literal case-insensitive vendor; inclusive ranges
span at most 1,825 days. Sorts expenseDate/createdAt/amount/vendorPayee asc/desc;
nullable vendors always last. Dates use YYYY-MM-DD: malformed input 400, impossible
calendar date 422 EXPENSE_INVALID_DATE. Foreign/missing resources receive the same 404.

All six mutation actions audit atomically with allowlisted before/after fields;
notes content is omitted. No Expense PendingEvents, queue work or request
idempotency is implemented. Cash Flow counts only ACTIVE source expenses;
P&L also counts the same authoritative source facts. Schema/migrations are unchanged.
The Category tenant/status/name and Expense tenant/createdAt/id indexes remain
explicit optimization follow-ups.

### Cash Flow — IMPLEMENTED (Prompt 17)

GET row 50 requires access authentication, current ACTIVE organization membership,
and analytics.read; OWNER/ADMIN/ACCOUNTANT/VIEWER may read. Only fromDate, toDate,
and groupBy are accepted. Missing bounds use the organization-local current month;
groupBy defaults to month and supports day/week/month, with ISO Monday weeks.
The inclusive range contains at most 366 calendar dates.

Returns data:{inflows,outflows,netCashFlow,series} and
meta:{fromDate,toDate,groupBy,currency,timezone,basis:"cash"}. Series items contain
periodStart (natural bucket start), inflows, outflows and netCashFlow; populated
buckets appear chronologically, without gap filling. Empty reports contain zero
totals and an empty series. Money remains Decimal and serializes as currency-scaled
strings, including negative net and sums above individual-record limits.

A narrow FinancialModule read adapter groups tenant-scoped RECORDED Payments by
paymentDate and ACTIVE Expenses by expenseDate in PostgreSQL. REVERSED/VOIDED rows
are excluded by current state, reversal rows are never subtracted again, and
archived categories do not exclude historical expenses. Invoice totals do not
contribute. Current organization settings and grouped facts share one read-only
repeatable-read transaction, with service reauthorization. Selected currency
inconsistency returns safe 422; invalid input 400, unauthorized tenant 404, missing
permission 403. No read audits, events, schema changes, cache, queue, FX, or bank
balance are introduced. The blueprint's Financial/CashFlow boundary is preserved.

### Profit & Loss — IMPLEMENTED (Prompt 18)

Row 51 exposes GET /api/v1/organizations/:organizationId/profit-loss with
analytics.read and current ACTIVE organization membership. Only fromDate, toDate,
and groupBy=none|month are accepted. Defaults match Cash Flow: current organization-
local month and month grouping, at most 366 inclusive calendar dates.

Returns data:{revenue,expenses,netResult,expenseByCategory,series?} and metadata
fromDate/toDate/groupBy/currency/timezone/basis:SIMPLIFIED_CASH with disclaimer
"Not a GAAP/IFRS financial statement.". Monthly entries are
{periodStart,revenue,expenses,netResult}; only populated months appear, in ascending
order, with partial-month facts clipped to the range. None omits series. Category
entries are {categoryId,categoryName,amount}, ordered by current name then ID,
including archived categories with active expenses. Empty reports have zero totals
and empty breakdowns; monthly series is empty. All money is Decimal/string.

The Financial reader reuses Cash Flow's RECORDED Payment/paymentDate and ACTIVE
Expense/expenseDate aggregation, reversal/void exclusion and currency checks,
then groups categories using the same read-only repeatable-read transaction.
No reversal rows are subtracted again, invoice totals never contribute, and reads
write no audits/events/models/jobs. Safe errors are 400 input, 403 permission,
404 concealed tenant access, and 422 selected currency mismatch. No schema change,
FX, accrual classifications or ledger is introduced. The roadmap's Step 19 P&L
capability is delivered under the user's explicit Prompt 18 request.

### Analytics — IMPLEMENTED (Prompt 19)

Rows 52-53 require analytics.read and current ACTIVE tenant membership. Summary
accepts fromDate/toDate/asOfDate (month bounds, tenant today, max 366 inclusive
dates). Aging accepts only asOfDate, default tenant today. No grouping/comparison
query exists. Summary returns billing {totalInvoiced,invoiceCounts}, collections
{collected,rate,averagePaymentDelayDays,sampleSize}, receivables {outstanding,overdue},
spending {expenses}, cash {netCashFlow,netResult}, customers {activeCount}.

Cash uses canonical period Payment/Expense totals. Billing/counts use issueDate;
rate uses current ISSUED issue-range cohort receipts through asOf divided by its
total (percentage string, four places, null zero denominator). Delay averages
final eligible receipt date minus due date on fully paid cohort invoices (two
places, null empty sample). Receivables recompute totals minus RECORDED receipts
through asOf for all current ISSUED invoices issued by asOf, independent of range.
DRAFT/CANCELLED/VOID claims, REVERSED receipts and VOIDED expenses do not count;
archived customers/categories retain eligible facts. Due today is not overdue.

Aging returns outstanding/overdue and five {bucket,invoiceCount,amount} entries:
CURRENT, 1_30, 31_60, 61_90, 91_PLUS. Empty buckets are zero. Metadata states
currency/timezone/resolved dates, CURRENT_STATE basis and KPI cohort/date definitions.
Amounts/ratios use Decimal strings; counts are integers. One read-only repeatable-
read transaction covers SQL aggregates and scoped customer count. No N+1, cache,
queue, writes, schema change, historical snapshot claim, forecast, or AI is added.
Invalid input is 400, tenant access concealed 404, permission 403, selected currency
mismatch 422, impossible source settlement 409. See api-contracts sections 9.15-16.

## 5. Current User Workflow and APIs

### Notifications — IMPLEMENTED (Prompt 20)

Rows 54-56 expose the current recipient's inbox/read/archive, with current tenant
membership and canonical notification.read/update_self. Inbox defaults to newest
UNREAD/READ rows, limit 25 (max 100), and accepts status, after, createdAt sort and
direction. Cursor scope includes organization/recipient/filter/direction. Commands
accept empty bodies, return 200, preserve original timestamps and keep archive
terminal. Other-recipient/tenant IDs are concealed 404; unknown input is 400.

Internal minute scans evaluate tenant-local daily occurrences: due-soon three days
before due, overdue days 1/8/15/etc., configurable enabled/cadence defaults. Current
ISSUED positive source balances, active customers and active organizations are
required; workers reload all RECORDED receipts and ignore settlement caches.
ReminderDelivery plus PendingEvent commit atomically, and database semantic keys
dedupe retries. In-app fan-out targets current invoice-read memberships; payment
notifications target payment-read memberships. Read/archive writes no financial audit.

The separate worker consumes supported INVOICE_ISSUED/PAYMENT_RECORDED/PAYMENT_REVERSED
and REMINDER_DELIVERY_REQUESTED events. Dispatch is post-commit and leased; transport
outages defer durable work, expired leases recover, and failed jobs/delivery statuses
remain observable. External email stays disabled, with explicit non-production
capture only. A reviewed migration corrects the notification link's tenant-composite
FK while preserving column-specific SET NULL. No manual reminder endpoint, vendor,
preferences, report/export, audit-read, frontend, or AI capability is added.

```text
Register
  → POST /api/v1/auth/register
Login
  → POST /api/v1/auth/login
Create organization
  → POST /api/v1/organizations
List/select organization
  → GET /api/v1/organizations
Invite user
  → POST /api/v1/organizations/:organizationId/invitations
Accept invitation
  → POST /api/v1/invitations/accept
Manage members
  → GET/PATCH/POST/DELETE membership and invitation routes
Manage customers
  → Customer create/list/detail/update/archive routes
Draft and issue invoices
  → Invoice create/list/detail/update/issue routes
Correct invalid documents
  → Draft delete or issued cancel/void routes
Record and correct receipts
  → Invoice payment POST and tenant Payment GET/reverse routes
Refresh session
  → POST /api/v1/auth/refresh
Log out
  → POST /api/v1/auth/logout or /api/v1/auth/logout-all
```

The current product flow includes organization, membership, customer, invoice,
payment recording, full reversal, expense category management, expense/void workflows,
and derived Cash Flow/P&L/dashboard/aging reads.

## 6. Reports and Future Product API Map

Reports below are implemented in Prompt 21. Audit Log remains planned.

### Reports — IMPLEMENTED

Rows 57–64 require current ACTIVE membership and canonical report permissions.
Previews return paginated JSON; request returns 202 PENDING metadata with an
optional recommended idempotency key. See api-contracts.md for per-type filters,
date bounds, CSV columns and metadata shapes. Export request/download are audited.
Requests commit ReportExport/PendingEvent before shared post-commit dispatch;
reports.generate reloads PostgreSQL sources and current requester access, generates
bounded private CSV, and atomically marks READY with one REPORT_READY notification.
Download is tenant-scoped, reauthorized, checks integrity/expiry and streams CSV
with a safe filename. Internal keys, paths, checksums and retry markers stay private.
Local artifacts expire after the configurable development lifetime; lazy expiry
retains files and metadata. No cloud integration or automatic cleanup is added.

| Method | Implemented Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/reports/invoices` | Invoice register preview | Reports |
| GET | `/api/v1/organizations/:organizationId/reports/payments` | Payment register preview | Reports |
| GET | `/api/v1/organizations/:organizationId/reports/expenses` | Expense register preview | Reports |
| GET | `/api/v1/organizations/:organizationId/reports/receivables` | Receivables preview | Reports |
| POST | `/api/v1/organizations/:organizationId/reports/exports` | Request CSV export | Reports |
| GET | `/api/v1/organizations/:organizationId/report-exports` | List export requests | Reports |
| GET | `/api/v1/organizations/:organizationId/report-exports/:exportId` | Get export state | Reports |
| GET | `/api/v1/organizations/:organizationId/report-exports/:exportId/download` | Download ready export | Reports |

### Audit Logs — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/audit-logs` | Search scoped immutable history | Audit Logs |

## 7. API → Frontend Page Mapping

| Frontend Page | APIs Used | Status |
|---|---|---|
| Login | `POST /auth/login`, `/auth/refresh`, `/auth/logout` | Frontend not implemented |
| Register | `POST /auth/register` | Frontend not implemented |
| Dashboard | Implemented Cash Flow/P&L and analytics summary | Frontend not implemented |
| Organization Selector | `GET /organizations`, `POST /organizations` | Frontend not implemented |
| Organization Settings | `GET/PATCH /organizations/:organizationId`, close, transfer ownership | Frontend not implemented |
| Members | Member and invitation routes | Frontend not implemented |
| Customers | Implemented customer collection POST/GET | Frontend not implemented |
| Customer Details | Implemented customer GET/PATCH/archive | Frontend not implemented |
| Invoices | Implemented invoice collection routes | Frontend not implemented |
| Invoice Details | Implemented invoice item/lifecycle and payment recording | Frontend not implemented |
| Payments | Implemented payment list/detail/reversal | Frontend not implemented |
| Expenses | Implemented expense/category routes | Frontend not implemented |
| Cash Flow | Implemented cash-flow route | Frontend not implemented |
| Profit & Loss | Implemented profit-loss route | Frontend not implemented |
| Analytics | Implemented summary/receivables-aging routes | Frontend not implemented |
| Notifications | Implemented own inbox/read/archive routes | Frontend not implemented |
| Reports | Implemented report/export routes | Frontend not implemented |
| Audit Logs | Planned audit-log route | Frontend not implemented |

## 8. API → Database Model Mapping

| API / Module | Main Prisma Models |
|---|---|
| Health | No domain model; readiness uses Prisma connection and Redis |
| Auth | `User`, `RefreshSession`, `RefreshToken`, `AuditLog` |
| Organizations | `Organization`, `Membership`, `InvoiceSequence`, `ExpenseCategory`, `AuditLog` |
| Memberships / Invitations | `Membership`, `OrganizationInvitation`, `Organization`, `User`, `AuditLog` |
| Customers | `Customer`, `Organization`, `Membership`, `AuditLog` |
| Invoices | `Invoice`, `InvoiceItem`, `InvoiceSequence`, `Customer`, `AuditLog`, `PendingEvent` |
| Payments | `Payment`, `PaymentReversal`, `Invoice`, `IdempotencyRecord`, `AuditLog`, `PendingEvent` |
| Expenses | `Expense`, `ExpenseCategory`, `Organization`, `Membership`, `AuditLog` |
| Cash Flow | `Payment`, `Expense`, `Organization`, `Membership` (read only) |
| P&L | `Payment`, `Expense`, `ExpenseCategory`, `Organization`, `Membership` (read only) |
| Analytics | `Invoice`, `Payment`, `Expense`, `Customer`, `Organization`, `Membership` (read only) |
| Notifications | `Notification`, `ReminderDelivery`, `PendingEvent`, `Invoice`, `Payment`, `Customer`, `Organization`, `Membership` |
| Reports | `ReportExport`, `PendingEvent`, `AuditLog`, `Notification`, `IdempotencyRecord` plus Financial source read models |
| Future Audit Logs | `AuditLog` |

## 9. API → Redis / BullMQ Mapping

| Current API | Redis / BullMQ interaction |
|---|---|
| `POST /auth/register` | Redis-backed registration rate limiting |
| `POST /auth/login` | Redis-backed IP/email rate limiting |
| `POST /auth/refresh` | Redis-backed refresh rate limiting |
| `GET /health/ready` | Redis readiness `PING` |
| All other implemented APIs | No direct Redis/BullMQ use |

BullMQ has canonical queue names, a factory and retry/backoff defaults. Prompt 20
implements separate-worker events.dispatch/dispatch, reminders.scan/scan,
reminders.deliver/event and notifications.email/event. Inbox APIs read/write PG
directly; the worker creates durable notifications. Real external email is disabled;
capture is development/test-only. Prompt 21 adds reports.generate/dispatch and
reports.generate/event using the same dispatcher and durable PostgreSQL export state.

## 10. Deployment Architecture

```text
React frontend (not implemented)
  ↓ HTTPS
NestJS backend API (local development only)
  ↓                         ↓
Managed PostgreSQL      Managed Redis / BullMQ
                              ↓
                        Separate notification/report BullMQ worker process
```

| Component | Deployment Target Type | Notes |
|---|---|---|
| Frontend | Static/edge frontend host, likely Vercel | React frontend is not built or deployed |
| Backend API | Long-running Node/NestJS service | Must support environment variables plus PostgreSQL and Redis connectivity; Render, Railway, Fly.io, AWS, or similar platforms are candidates |
| PostgreSQL | Managed PostgreSQL | Source of truth for product and session data |
| Redis | Managed Redis | Supports rate limits and BullMQ infrastructure; not financial truth |
| BullMQ Worker | Separate long-running worker process | Implemented locally; not deployed |

Vercel should not be assumed to host the full long-running NestJS plus BullMQ
worker architecture. No production deployment has occurred.

## 11. Which APIs Are Public vs Protected

### Public

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`

### Credential-Based

- `POST /api/v1/auth/refresh` requires the refresh cookie.
- `POST /api/v1/auth/logout` accepts bearer access credentials or a refresh cookie.

### Authenticated

- `POST /api/v1/auth/logout-all`
- `GET /api/v1/me`
- `POST /api/v1/organizations`
- `GET /api/v1/organizations`

### Tenant + Permission Protected

- Organization item, settings, and closure routes.
- Member, invitation, and ownership-transfer routes.
- Customer collection/detail/update/archive routes.
- Invoice collection/detail/update/delete/issue/cancel/void routes.
- Payment record/list/detail/reversal routes.
- Expense category collection/update/archive and Expense collection/detail/update/void routes.
- Cash Flow, P&L, summary and aging aggregate routes.
- Own notification inbox/read/archive routes.
- All planned
  report, and audit routes.

Tenant protection means access authentication, an ACTIVE membership in the
requested organization, current ACTIVE organization state, and required route
permission. Missing/inactive tenant access is concealed as `404`; insufficient
permission for an active member is `403`.

## 12. Permission-Protected APIs

| Endpoint | Required Permission |
|---|---|
| `GET /organizations/:organizationId` | `organization.read` |
| `PATCH /organizations/:organizationId` | `organization.update` |
| `POST /organizations/:organizationId/close` | `organization.close` |
| `GET /organizations/:organizationId/members` | `membership.read` |
| `POST /organizations/:organizationId/invitations` | `membership.invite` |
| `GET /organizations/:organizationId/invitations` | `membership.read` |
| `DELETE /organizations/:organizationId/invitations/:invitationId` | `membership.invite` |
| `PATCH /organizations/:organizationId/members/:membershipId` | `membership.change_role` |
| `POST /organizations/:organizationId/members/:membershipId/suspend` | `membership.suspend` |
| `POST /organizations/:organizationId/members/:membershipId/reactivate` | `membership.suspend` |
| `DELETE /organizations/:organizationId/members/:membershipId` | `membership.remove` |
| `POST /organizations/:organizationId/transfer-ownership` | `organization.transfer_ownership` |
| `POST /organizations/:organizationId/customers` | `customer.create` |
| `GET /organizations/:organizationId/customers` | `customer.read` |
| `GET /organizations/:organizationId/customers/:customerId` | `customer.read` |
| `PATCH /organizations/:organizationId/customers/:customerId` | `customer.update` |
| `POST /organizations/:organizationId/customers/:customerId/archive` | `customer.archive` |
| `POST /organizations/:organizationId/invoices` | `invoice.create` |
| `GET /organizations/:organizationId/invoices` | `invoice.read` |
| `GET /organizations/:organizationId/invoices/:invoiceId` | `invoice.read` |
| `PATCH /organizations/:organizationId/invoices/:invoiceId` | `invoice.update_draft` |
| `DELETE /organizations/:organizationId/invoices/:invoiceId` | `invoice.delete_draft` |
| `POST /organizations/:organizationId/invoices/:invoiceId/issue` | `invoice.issue` |
| `POST /organizations/:organizationId/invoices/:invoiceId/cancel` | `invoice.cancel` |
| `POST /organizations/:organizationId/invoices/:invoiceId/void` | `invoice.void` |
| `POST /organizations/:organizationId/invoices/:invoiceId/payments` | `payment.create` |
| `GET /organizations/:organizationId/payments` | `payment.read` |
| `GET /organizations/:organizationId/payments/:paymentId` | `payment.read` |
| `POST /organizations/:organizationId/payments/:paymentId/reverse` | `payment.reverse` |
| `GET /organizations/:organizationId/expense-categories` | `expense.read` |
| `POST /organizations/:organizationId/expense-categories` | `expense_category.manage` |
| `PATCH /organizations/:organizationId/expense-categories/:categoryId` | `expense_category.manage` |
| `POST /organizations/:organizationId/expense-categories/:categoryId/archive` | `expense_category.manage` |
| `POST /organizations/:organizationId/expenses` | `expense.create` |
| `GET /organizations/:organizationId/expenses` | `expense.read` |
| `GET /organizations/:organizationId/expenses/:expenseId` | `expense.read` |
| `PATCH /organizations/:organizationId/expenses/:expenseId` | `expense.update` |
| `POST /organizations/:organizationId/expenses/:expenseId/void` | `expense.void` |
| `GET /organizations/:organizationId/cash-flow` | `analytics.read` |
| `GET /organizations/:organizationId/profit-loss` | `analytics.read` |
| `GET /organizations/:organizationId/analytics/summary` | `analytics.read` |
| `GET /organizations/:organizationId/analytics/receivables-aging` | `analytics.read` |
| `GET /organizations/:organizationId/notifications` | `notification.read` |
| `POST /organizations/:organizationId/notifications/:notificationId/read` | `notification.update_self` |
| `POST /organizations/:organizationId/notifications/:notificationId/archive` | `notification.update_self` |
| `GET /organizations/:organizationId/reports/invoices`, `/reports/payments`, `/reports/expenses`, `/reports/receivables` | `report.read` |
| `POST /organizations/:organizationId/reports/exports` | `report.export` |
| `GET /organizations/:organizationId/report-exports[/:exportId[/download]]` | `report.export` |

### Planned Permission Map — NOT IMPLEMENTED

| Planned API area | Required Permission |
|---|---|
| Audit Logs | `audit.read` |

## 13. API Status Legend

- **IMPLEMENTED:** registered controller route with current application logic.
- **IMPLEMENTED WITH CAVEAT:** registered and functional, with an identified
  product limitation.
- **PLANNED:** documented contract route not registered in source.
- **DEFERRED:** intentionally scheduled for a later milestone.
- **INTERNAL:** non-public runtime behavior such as a service operation.
- **INFRASTRUCTURE:** health, queue, Redis, or other operational capability.

## 14. Known API Gaps

- Production invitation delivery is missing; invitation tokens are only returned
  in protected development responses while email delivery is unavailable.
- Broader conceptual Customer fields need a future reviewed schema migration.
- Optional Invoice notes/terms/reference and recommended invoice idempotency replay are deferred.
- Optional Payment reference/notes/reference search await schema support.
- Expense request idempotency and the two documented performance indexes are deferred.
- Historical analytics reconstruction and audit-read APIs are not implemented.
- Report storage is local/private; cloud deployment and file retention cleanup remain deferred.
- There is no AuditLog read API.
- Swagger/OpenAPI is deferred to Prompt 27.
- A React frontend is absent.
- The backend is not deployed; infrastructure remains local development.
- Notification workers are local only; real email/provider consent and operational recovery tooling remain deferred.

## 15. Update Rules

### How to maintain this file

After every implementation milestone:

1. Inspect controllers.
2. Add newly implemented routes.
3. Update API totals.
4. Move routes from PLANNED to IMPLEMENTED.
5. Update frontend mapping.
6. Update database model mapping if needed.
7. Update permission mapping.
8. Update deployment notes only if architecture changes.

Do not manually increase the API count without verifying controllers.

## 16. Final Dashboard

- Current implemented APIs: **64**
- Estimated final APIs: **65–70**
- Implemented modules: **13 HTTP modules** — Health, Auth, Organizations, Memberships/Invitations, Customers, Invoices, Payments, Expenses, Cash Flow, P&L, Analytics, Notifications, Reports
- Financial/report APIs implemented: **33**
- Frontend implemented: **No**
- Backend deployed: **No**
- Next feature: **Audit Log API, pending a separate request**
