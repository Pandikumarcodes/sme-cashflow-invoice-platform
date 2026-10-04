# SME Cash Flow & Invoice Management System — API Inventory

This is the maintained inventory of the HTTP API surface. Implemented routes are
verified against controllers in `src/`; planned routes come from
`docs/api-contracts.md` and are explicitly labelled.

## 1. API Summary

- Current implemented APIs: **23**
- Estimated final APIs: **60–70**
- Estimated remaining APIs: **37–47**
- Current milestone: **Prompt 11 complete / before Prompt 12**
- Base path: `/api/v1`
- Authentication: Bearer access token plus HttpOnly refresh cookie
- Backend deployment: Local development only

The estimate is based on the current API-contract route map. It is not a
commitment that every planned route will remain separate.

---

## 2. API Count by Module

| Module | Implemented APIs | Planned APIs | Status |
|---|---:|---:|---|
| Health | 2 | 0 | IMPLEMENTED |
| Auth | 6 | 0 | IMPLEMENTED |
| Organizations | 5 | 0 | IMPLEMENTED |
| Memberships / Invitations | 10 | 0 | IMPLEMENTED WITH CAVEAT |
| Customers | 0 | 5 | PLANNED — NOT IMPLEMENTED |
| Invoices | 0 | 8 | PLANNED — NOT IMPLEMENTED |
| Payments | 0 | 4 | PLANNED — NOT IMPLEMENTED |
| Expenses | 0 | 9 | PLANNED — NOT IMPLEMENTED |
| Cash Flow | 0 | 1 | PLANNED — NOT IMPLEMENTED |
| P&L | 0 | 1 | PLANNED — NOT IMPLEMENTED |
| Analytics | 0 | 2 | PLANNED — NOT IMPLEMENTED |
| Notifications | 0 | 3 | PLANNED — NOT IMPLEMENTED |
| Reports | 0 | 8 | PLANNED — NOT IMPLEMENTED |
| Audit Logs | 0 | 1 | PLANNED — NOT IMPLEMENTED |
| **Total** | **23** | **42** | **Estimated final baseline: 65** |

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

**TOTAL IMPLEMENTED APIs: 23**

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

## 5. Current User Workflow and APIs

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
Refresh session
  → POST /api/v1/auth/refresh
Log out
  → POST /api/v1/auth/logout or /api/v1/auth/logout-all
```

The current product flow stops after organization and membership management.

## 6. Future Product API Map

Every route in this section is **PLANNED — NOT IMPLEMENTED**. These are
finalized contract routes, subject to implementation review.

### Customers — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| POST | `/api/v1/organizations/:organizationId/customers` | Create customer | Customers |
| GET | `/api/v1/organizations/:organizationId/customers` | List/search customers | Customers |
| GET | `/api/v1/organizations/:organizationId/customers/:customerId` | Get customer | Customer Details |
| PATCH | `/api/v1/organizations/:organizationId/customers/:customerId` | Update customer | Customer Details |
| POST | `/api/v1/organizations/:organizationId/customers/:customerId/archive` | Archive customer | Customer Details |

### Invoices — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| POST | `/api/v1/organizations/:organizationId/invoices` | Create draft invoice | Invoices |
| GET | `/api/v1/organizations/:organizationId/invoices` | List/search invoices | Invoices |
| GET | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Get invoice | Invoice Details |
| PATCH | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Update draft invoice | Invoice Details |
| DELETE | `/api/v1/organizations/:organizationId/invoices/:invoiceId` | Delete draft invoice | Invoice Details |
| POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/issue` | Issue and number invoice | Invoice Details |
| POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/cancel` | Cancel issued invoice with no payment rows | Invoice Details |
| POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/void` | Void eligible issued invoice | Invoice Details |

### Payments — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| POST | `/api/v1/organizations/:organizationId/invoices/:invoiceId/payments` | Record payment | Invoice Details |
| GET | `/api/v1/organizations/:organizationId/payments` | List payments | Payments |
| GET | `/api/v1/organizations/:organizationId/payments/:paymentId` | Get payment | Payments |
| POST | `/api/v1/organizations/:organizationId/payments/:paymentId/reverse` | Reverse payment | Payments |

### Expenses — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/expense-categories` | List categories | Expenses |
| POST | `/api/v1/organizations/:organizationId/expense-categories` | Create category | Expenses |
| PATCH | `/api/v1/organizations/:organizationId/expense-categories/:categoryId` | Update category | Expenses |
| POST | `/api/v1/organizations/:organizationId/expense-categories/:categoryId/archive` | Archive category | Expenses |
| POST | `/api/v1/organizations/:organizationId/expenses` | Create expense | Expenses |
| GET | `/api/v1/organizations/:organizationId/expenses` | List expenses | Expenses |
| GET | `/api/v1/organizations/:organizationId/expenses/:expenseId` | Get expense | Expenses |
| PATCH | `/api/v1/organizations/:organizationId/expenses/:expenseId` | Update expense | Expenses |
| POST | `/api/v1/organizations/:organizationId/expenses/:expenseId/void` | Void expense | Expenses |

### Cash Flow — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/cash-flow` | Actual cash inflow/outflow/net | Cash Flow |

### P&L — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/profit-loss` | Simplified cash-basis performance | Profit & Loss |

### Analytics — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/analytics/summary` | Dashboard financial metrics | Dashboard / Analytics |
| GET | `/api/v1/organizations/:organizationId/analytics/receivables-aging` | Receivables aging | Analytics |

### Notifications — PLANNED

| Method | Planned Route | Purpose | Future UI |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/notifications` | List recipient notifications | Notifications |
| POST | `/api/v1/organizations/:organizationId/notifications/:notificationId/read` | Mark own notification read | Notifications |
| POST | `/api/v1/organizations/:organizationId/notifications/:notificationId/archive` | Archive own notification | Notifications |

### Reports — PLANNED

| Method | Planned Route | Purpose | Future UI |
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
| Dashboard | Planned analytics/cash-flow/P&L routes | Frontend not implemented |
| Organization Selector | `GET /organizations`, `POST /organizations` | Frontend not implemented |
| Organization Settings | `GET/PATCH /organizations/:organizationId`, close, transfer ownership | Frontend not implemented |
| Members | Member and invitation routes | Frontend not implemented |
| Customers | Planned customer routes | Frontend not implemented |
| Customer Details | Planned customer item routes | Frontend not implemented |
| Invoices | Planned invoice collection routes | Frontend not implemented |
| Invoice Details | Planned invoice item, lifecycle, and payment routes | Frontend not implemented |
| Payments | Planned payment routes | Frontend not implemented |
| Expenses | Planned expense/category routes | Frontend not implemented |
| Cash Flow | Planned cash-flow route | Frontend not implemented |
| Profit & Loss | Planned profit-loss route | Frontend not implemented |
| Analytics | Planned analytics routes | Frontend not implemented |
| Notifications | Planned notification routes | Frontend not implemented |
| Reports | Planned report/export routes | Frontend not implemented |
| Audit Logs | Planned audit-log route | Frontend not implemented |

## 8. API → Database Model Mapping

| API / Module | Main Prisma Models |
|---|---|
| Health | No domain model; readiness uses Prisma connection and Redis |
| Auth | `User`, `RefreshSession`, `RefreshToken`, `AuditLog` |
| Organizations | `Organization`, `Membership`, `InvoiceSequence`, `ExpenseCategory`, `AuditLog` |
| Memberships / Invitations | `Membership`, `OrganizationInvitation`, `Organization`, `User`, `AuditLog` |
| Future Customers | `Customer`, `AuditLog` |
| Future Invoices | `Invoice`, `InvoiceItem`, `InvoiceSequence`, `Customer`, `AuditLog`, `PendingEvent` |
| Future Payments | `Payment`, `PaymentReversal`, `Invoice`, `IdempotencyRecord`, `AuditLog`, `PendingEvent` |
| Future Expenses | `Expense`, `ExpenseCategory`, `AuditLog` |
| Future Notifications | `Notification`, `ReminderDelivery`, `Invoice` |
| Future Reports | `ReportExport`, `PendingEvent`, `AuditLog` |
| Future Audit Logs | `AuditLog` |

## 9. API → Redis / BullMQ Mapping

| Current API | Redis / BullMQ interaction |
|---|---|
| `POST /auth/register` | Redis-backed registration rate limiting |
| `POST /auth/login` | Redis-backed IP/email rate limiting |
| `POST /auth/refresh` | Redis-backed refresh rate limiting |
| `GET /health/ready` | Redis readiness `PING` |
| All other implemented APIs | No direct Redis/BullMQ use |

BullMQ has queue names, a queue factory, default retry/backoff configuration, and
a smoke test. No current public API depends on a production business worker.

Planned future use:

- **PLANNED — NOT IMPLEMENTED:** reminder scan and delivery jobs.
- **PLANNED — NOT IMPLEMENTED:** notification/email delivery.
- **PLANNED — NOT IMPLEMENTED:** report generation.
- **PLANNED — NOT IMPLEMENTED:** pending-event processing.

## 10. Deployment Architecture

```text
React frontend (not implemented)
  ↓ HTTPS
NestJS backend API (local development only)
  ↓                         ↓
Managed PostgreSQL      Managed Redis / BullMQ
                              ↓
                        Separate BullMQ worker process (planned)
```

| Component | Deployment Target Type | Notes |
|---|---|---|
| Frontend | Static/edge frontend host, likely Vercel | React frontend is not built or deployed |
| Backend API | Long-running Node/NestJS service | Must support environment variables plus PostgreSQL and Redis connectivity; Render, Railway, Fly.io, AWS, or similar platforms are candidates |
| PostgreSQL | Managed PostgreSQL | Source of truth for product and session data |
| Redis | Managed Redis | Supports rate limits and BullMQ infrastructure; not financial truth |
| BullMQ Worker | Separate long-running worker process | Deploy when business workers exist |

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
- All planned customer, invoice, payment, expense, analytics, notification,
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

### Planned Permission Map — NOT IMPLEMENTED

| Planned API area | Required Permission |
|---|---|
| Customer collection/item/archive | `customer.create`, `customer.read`, `customer.update`, `customer.archive` |
| Invoice collection/item/lifecycle | `invoice.create`, `invoice.read`, `invoice.update_draft`, `invoice.delete_draft`, `invoice.issue`, `invoice.cancel`, `invoice.void` |
| Payments | `payment.create`, `payment.read`, `payment.reverse` |
| Expense categories and expenses | `expense.read`, `expense_category.manage`, `expense.create`, `expense.update`, `expense.void` |
| Cash Flow, P&L, Analytics | `analytics.read` |
| Reports and exports | `report.read`, `report.export` |
| Notifications | `notification.read`, `notification.update_self` |
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
- Prompt 12 reusable tenant-context/query infrastructure is pending.
- Customer, invoice, payment, expense, financial-query, notification, report,
  and audit-read APIs are not implemented.
- There is no AuditLog read API.
- Swagger/OpenAPI is deferred to Prompt 27.
- A React frontend is absent.
- The backend is not deployed; only local Compose infrastructure exists.
- BullMQ has no production business worker or public API dependency.

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

- Current implemented APIs: **23**
- Estimated final APIs: **60–70**
- Implemented modules: **4 HTTP modules** — Health, Auth, Organizations, Memberships/Invitations
- Financial APIs implemented: **0**
- Frontend implemented: **No**
- Backend deployed: **No**
- Next milestone: **Prompt 12 — Tenant Isolation Infrastructure**
