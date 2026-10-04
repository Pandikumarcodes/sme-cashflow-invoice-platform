# Backend API Contracts

## 1. Contract status and principles

This document is the conceptual REST contract for the NestJS backend. It defines public semantics, not implementation classes or OpenAPI decorators.

- URI versioning with base path `/api/v1`; no `/v2` is created until a breaking contract requires it.
- JSON request/response fields use `camelCase`; resource paths use lowercase plural kebab-case.
- Tenant resources are nested under `/organizations/:organizationId`.
- The route organization ID identifies the requested context but never authorizes it. Authentication → ACTIVE Membership → permission → domain policy → tenant-scoped persistence is mandatory.
- Domain transitions use explicit command endpoints; clients cannot patch authoritative status.
- Monetary, quantity, and percentage decimals are JSON strings.
- Business dates are `YYYY-MM-DD`; instants are ISO-8601 UTC strings.
- Unknown body/query fields are rejected. DTOs are allowlists and raw bodies are never spread into persistence.

URI versioning is visible, easy to route/document, and appropriate for a single REST backend. Backward-compatible additions remain within v1; removals, renamed meaning, or incompatible field/type changes require a future version and migration policy.

## 2. HTTP and response conventions

### Methods and commands

- `GET` reads and is side-effect free except safe access logging/audit of sensitive downloads.
- `POST` creates resources or invokes meaningful commands (`issue`, `cancel`, `void`, `reverse`, `transfer-ownership`).
- `PATCH` performs partial updates to mutable resource fields and requires optimistic concurrency where documented.
- `DELETE` is used only where client semantics are removal and domain rules permit it, such as draft deletion or membership removal; it never implies database hard deletion of retained records.
- `PUT` is not used in MVP.

Explicit commands prevent illegal `PATCH {"status":"PAID"}` behavior. PAID derives only from payments; issue/reversal/ownership transfer have transactions, locks, permissions, and audit not represented by a generic status patch.

### Success envelope

Single resource/command:

```json
{
  "data": {
    "id": "2fe0d920-99b0-4d5f-8df1-3db1bed38c22"
  }
}
```

Collection:

```json
{
  "data": [],
  "meta": {
    "limit": 25,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Aggregate responses use `data` plus their own `meta` for period/currency/timezone. `204` has no body. Responses include `X-Request-Id`. Mutable versioned resources include integer `version` and an `ETag` equivalent such as `"3"`; update requests send `If-Match: "3"`.

### Status codes

| Status | Use |
|---|---|
| `200 OK` | Successful read, update, command, login/refresh |
| `201 Created` | Synchronous resource creation |
| `202 Accepted` | Asynchronous report export accepted |
| `204 No Content` | Successful logout/removal/archive command with no response |
| `400 Bad Request` | Malformed JSON/header/query, unknown field, invalid syntax/type |
| `401 Unauthorized` | Missing/invalid/expired credentials or session |
| `403 Forbidden` | Active tenant membership exists but lacks permission/contextual authority |
| `404 Not Found` | Missing or cross-tenant resource/tenant; no existence disclosure |
| `409 Conflict` | Lifecycle, optimistic concurrency, uniqueness, idempotency-key reuse, last-owner conflict |
| `422 Unprocessable Entity` | Valid request shape but value/business arithmetic is invalid (e.g. overpayment) |
| `429 Too Many Requests` | Rate policy exceeded; include `Retry-After` |
| `500 Internal Server Error` | Unexpected safe failure; request ID only |
| `503 Service Unavailable` | Dependency unavailable/readiness failure where relevant |

Rule: 409 means the command conflicts with current resource identity/version/lifecycle; 422 means the submitted values are semantically unacceptable. `PAYMENT_EXCEEDS_BALANCE` is 422 even when a concurrent payment changed the balance; internal lock/serialization errors are translated/retried and never exposed.

## 3. Pagination, filtering, sorting, and search

### Cursor pagination

All standard collections use opaque cursor pagination: `limit` default 25, minimum 1, maximum 100; `after` optional opaque server cursor. Cursor encodes the endpoint's stable sort tuple and filter signature/version; clients must not construct it. Changing filters/sort while reusing a cursor returns `400 INVALID_CURSOR`.

Response metadata is `limit`, `nextCursor`, and `hasMore`. Total count is omitted by default because it can be expensive/inconsistent; endpoints may provide an explicitly documented snapshot count. Default sorts include an ID tie-breaker.

### Sorting

Use `sortBy=<allowlistedField>&sortOrder=asc|desc`. Unknown fields/directions return 400; never interpolate arbitrary client values. Defaults:

| Resource | Default | Allowed `sortBy` |
|---|---|---|
| Organizations | `createdAt desc` | `createdAt`, `displayName` |
| Members | `createdAt asc` | `createdAt`, `role`, `status` |
| Customers | `displayName asc` | `displayName`, `createdAt`, `updatedAt` |
| Invoices | `issueDate desc` | `issueDate`, `dueDate`, `createdAt`, `total`, `invoiceNumber` |
| Payments | `paymentDate desc` | `paymentDate`, `recordedAt`, `amount` |
| Expenses | `expenseDate desc` | `expenseDate`, `createdAt`, `amount`, `vendorPayee` |
| Notifications/Audit | `createdAt/occurredAt desc` | Their timestamp only plus allowlisted audit fields |

### Filtering and search

Query values are single unless documented as comma-separated enum sets. Unsupported parameters are rejected.

- Customers (Prompt 13): `status` (`ACTIVE` default, or `ARCHIVED`) and `search`. Search matches the implemented display name and email using bounded, literal case-insensitive PostgreSQL patterns; minimum 2, maximum 100 characters. `customerType` and other fields absent from the current Prisma model are not accepted.
- Invoices: `status`, `paymentState`, `overdue`, `customerId`, `issueDateFrom/To`, `dueDateFrom/To`, `search`. Search matches invoice number and customer snapshot/display name within tenant.
- Payments (Prompt 15): `invoiceId`, `status`, `method`, `paymentDateFrom/To`; reference search is deferred because reference is absent from the current schema.
- Expenses: `categoryId`, `status`, `expenseDateFrom/To`, `vendor`.
- Audit: `actorUserId`, `action`, `entityType`, `entityId`, `occurredFrom/To`.

No Elasticsearch is introduced. Leading-wildcard search performance must be monitored and indexed/search strategy revisited only with evidence.

### Date ranges

Business dates require exact `YYYY-MM-DD`, real calendar validity, and `from <= to`. Financial aggregate/report ranges are inclusive and max 366 days in MVP. Resource-list ranges are max 1,825 days. Missing aggregate bounds default to current organization-local calendar month; responses echo resolved bounds. DATE comparisons use stored dates; instant filters use the organization's timezone and a half-open UTC interval. Server-local timezone is never used.

## 4. Decimal and validation contract

- Money/result and unit-price inputs are strings compatible with positive canonical decimal syntax and at most 15 integer/4 fractional digits; final payment/expense/fixed-discount values must additionally obey currency minor units (INR 2).
- Quantity is a positive decimal string with at most 13 integer/6 fractional digits within `NUMERIC(19,6)`.
- Percentage is a decimal string with up to 3 integer/6 fractional digits and domain range 0–100.
- Scientific notation, signs where non-negative is required, commas, whitespace, `NaN`, and JSON numeric values are rejected.
- Responses render money with the currency scale (e.g. `"12500.50"` for INR), quantities without unsafe number conversion, and percentages as canonical strings.

Validation layers:

1. **Transport:** JSON shape, required/unknown fields, UUID, enum, lengths, decimal/date syntax, item counts, header shape.
2. **Domain:** membership/resource tenant, lifecycle, immutable fields, calculations, balance, owner rules.
3. **Database:** non-null/FK/composite tenant/check/unique invariants.

The layers are complementary. A DB error maps to a safe domain/API code and never leaks Prisma, SQL, or constraint names.

## 5. Error contract

```json
{
  "error": {
    "code": "PAYMENT_EXCEEDS_BALANCE",
    "message": "Payment amount exceeds the outstanding invoice balance.",
    "details": {
      "currency": "INR",
      "remainingBalance": "300.00"
    },
    "requestId": "7d99162f-e59a-4a28-a805-a48e376fd9bb"
  }
}
```

`code` is stable; `message` is safe human text and may later localize; `details` is optional, schema-specific, and never reveals another tenant or sensitive internals. Clients must branch on code, not message.

Validation error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "fields": [
      {
        "field": "dueDate",
        "code": "INVALID_DATE",
        "message": "dueDate must use YYYY-MM-DD format."
      }
    ],
    "requestId": "7d99162f-e59a-4a28-a805-a48e376fd9bb"
  }
}
```

Field paths use request names such as `items[0].quantity`. Sort field errors deterministically. Never return stack/JWT details, SQL, Prisma metadata, raw constraint names, secret values, or cross-tenant existence.

### Domain-error mapping

| Code | HTTP | Safe behavior/details |
|---|---:|---|
| `RESOURCE_NOT_FOUND` | 404 | “Resource not found”; no tenant detail |
| `UNAUTHENTICATED` / `INVALID_SESSION` | 401 | Generic; clear invalid refresh cookie where relevant |
| `FORBIDDEN` | 403 | Permission denied; permission name may be omitted externally |
| `TENANT_MISMATCH` | 404 | Map externally to RESOURCE_NOT_FOUND |
| `VALIDATION_FAILED` | 400/422 | Externally `VALIDATION_ERROR`; field errors only |
| `CONCURRENT_MODIFICATION` | 409 | Include current ETag/version only if resource is authorized |
| `DUPLICATE_MEMBERSHIP` | 409 | No other-tenant detail |
| `LAST_OWNER_REMOVAL_FORBIDDEN` | 409 | Explain ownership transfer required |
| `OWNER_TRANSFER_REQUIRED` | 409 | Safe target rule |
| `DUPLICATE_INVOICE_NUMBER` | 409 | Rare allocation conflict; safe retry guidance |
| `INVALID_INVOICE_STATE` / `INVOICE_FINALIZED` | 409 | Current authorized lifecycle may be included |
| `INVALID_MONEY/QUANTITY/DISCOUNT/TAX` | 422 | Safe field/value bounds |
| `CURRENCY_MISMATCH` | 422 | Organization currency may be included |
| `CURRENCY_LOCKED` | 409 | Currency cannot change |
| `PAYMENT_EXCEEDS_BALANCE` | 422 | Authorized remaining balance may be included |
| `PAYMENT_ALREADY_REVERSED` / `PAYMENT_IMMUTABLE` | 409 | Safe state message |
| `ACTIVE_PAYMENTS_EXIST` | 409 | Blocks cancel/void |
| `IDEMPOTENCY_CONFLICT` | 409 | Never reveal prior payload |
| `INVITATION_INVALID_OR_EXPIRED` | 410 | Same message for invalid/expired/used token |
| `RATE_LIMITED` | 429 | `Retry-After` |

## 6. Writable-field and mass-assignment rules

Never accept context/derived/internal fields: `organizationId` on scoped bodies, `createdByUserId`, actor/session IDs, role permissions, lifecycle/payment status, invoice number/sequence/currency, subtotal/discountTotal/taxableTotal/taxTotal/total, amountPaid/balanceDue/paymentState/isOverdue, issued/cancelled/voided/reversed timestamps, reversal linkage, created/updated timestamps, version except through `If-Match`, audit fields, job/export internal state, storage keys, or notification recipient on self actions.

Every request schema rejects unknown properties. Nested items are also allowlisted. Server constructs persistence commands explicitly.

## 7. Core resource representations

### Invoice response

```json
{
  "data": {
    "id": "uuid",
    "invoiceNumber": "INV-000123",
    "status": "ISSUED",
    "paymentState": "PARTIALLY_PAID",
    "isOverdue": true,
    "customer": { "id": "uuid", "displayName": "Acme Traders" },
    "issueDate": "2026-09-01",
    "dueDate": "2026-09-15",
    "currency": "INR",
    "items": [
      {
        "id": "uuid",
        "description": "Consulting",
        "quantity": "10",
        "unitPrice": "1250.0000",
        "lineAmount": "12500.00",
        "sortOrder": 0
      }
    ],
    "discount": { "type": "PERCENTAGE", "value": "10.000000" },
    "taxRate": "18.000000",
    "subtotal": "12500.00",
    "discountTotal": "1250.00",
    "taxableTotal": "11250.00",
    "taxTotal": "2025.00",
    "total": "13275.00",
    "amountPaid": "4000.00",
    "balanceDue": "9275.00",
    "purchaseOrderReference": null,
    "notes": null,
    "terms": null,
    "issuedAt": "2026-09-01T09:30:00.000Z",
    "cancelledAt": null,
    "voidedAt": null,
    "version": 3,
    "createdAt": "2026-08-31T10:00:00.000Z",
    "updatedAt": "2026-09-10T08:00:00.000Z"
  }
}
```

Draft number/issued fields are null. CANCELLED/VOID has paymentState `NOT_APPLICABLE`; its arithmetic balance may remain but receivable eligibility is false. Customer detail may include the issued snapshot on detail endpoints while lists use a summary.

### Common representations

- User: id, email, firstName, lastName, status, emailVerifiedAt, lastLoginAt, createdAt; never hash/security internals.
- Organization: id, legalName, displayName, slug, baseCurrency, timezone, locale, invoicePrefix, padding, default terms, status, currencyLockedAt, version, timestamps.
- Payment: id, invoice summary, amount/currency, paymentDate/method/reference/notes, status, recordedAt/reversedAt, creator summary, timestamps; reversal detail when authorized.
- Expense: id, category summary, vendorPayee, amount/currency, expenseDate, description/reference/notes, status/void evidence, version, timestamps.

## 8. Endpoint catalog

### Authentication and self

- `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`
- `GET /me`
- `GET /organizations` lists organizations for ACTIVE memberships; this is the canonical organization selector (no duplicate `/me/organizations`).

### Organizations and membership

- `POST /organizations`; `GET /organizations/:organizationId`; `PATCH /organizations/:organizationId`
- `POST /organizations/:organizationId/close`
- `POST /organizations/:organizationId/transfer-ownership`
- `GET /organizations/:organizationId/members`
- `POST /organizations/:organizationId/invitations`; `GET .../invitations`; `DELETE .../invitations/:invitationId`
- `POST /invitations/accept` (authenticated User, invite token establishes intended tenant only after validation)
- `PATCH /organizations/:organizationId/members/:membershipId`
- `POST .../members/:membershipId/suspend`; `POST .../reactivate`; `DELETE .../members/:membershipId`

### Customers, invoices, payments, expenses

- Customers: collection POST/GET; item GET/PATCH; `POST .../:customerId/archive`
- Invoices: collection POST/GET; item GET/PATCH/DELETE (DELETE draft only); item commands `/issue`, `/cancel`, `/void`
- Payments: `POST /organizations/:organizationId/invoices/:invoiceId/payments`; tenant payment collection/item GET; `POST .../payments/:paymentId/reverse`
- Expense categories: collection GET/POST; item PATCH; `POST .../:categoryId/archive`
- Expenses: collection POST/GET; item GET/PATCH; `POST .../:expenseId/void`

### Financial reads, reports, notification, audit

- `GET /organizations/:organizationId/cash-flow`
- `GET /organizations/:organizationId/profit-loss`
- `GET /organizations/:organizationId/analytics/summary`
- `GET /organizations/:organizationId/analytics/receivables-aging`
- Report previews: `/reports/invoices`, `/reports/payments`, `/reports/expenses`, `/reports/receivables`
- Exports: collection POST/GET; item GET; `GET .../report-exports/:exportId/download`
- Notifications: collection GET; `POST .../:notificationId/read`; `POST .../:notificationId/archive`
- `GET /organizations/:organizationId/audit-logs`
- Public infrastructure: `GET /health/live`, `GET /health/ready` (minimal details).

## 9. Detailed endpoint contracts

### 9.1 Register

- **Route/Purpose:** `POST /api/v1/auth/register`; create global User only.
- **Authentication/Tenant/Permission:** none; no tenant.
- **Request:** `{email,password,firstName,lastName}` only.
- **Validation:** normalized valid email; password 12–128 characters/byte ceiling; names 1–100.
- **Domain/Transaction:** normalized email globally unique; hash Argon2id; User and safe audit event transaction as applicable.
- **Idempotency:** not required; duplicate normalized email is 409 `EMAIL_UNAVAILABLE`.
- **Response:** `201 {data: safeUser}`; no tokens/cookies.
- **Errors/Audit:** 400 validation, 409 duplicate, 429; audit registration success/security failure without password.

### 9.2 Login

- **Route:** `POST /api/v1/auth/login`.
- **Request:** `{email,password}`.
- **Rules/Transaction:** generic credential validation; create RefreshSession + first RefreshToken hash atomically, update lastLoginAt, audit.
- **Response:** `200 {data:{accessToken,tokenType:"Bearer",expiresIn:900,user:safeUser}}` plus secure refresh cookie.
- **Errors:** generic 401 `INVALID_CREDENTIALS`; 429. No account existence/status disclosure.

### 9.3 Refresh

- **Route:** `POST /api/v1/auth/refresh`; empty JSON body or no body; refresh cookie required.
- **Rules/Transaction:** validate Origin policy; rotate token exactly once per authentication design.
- **Response:** `200 {data:{accessToken,tokenType:"Bearer",expiresIn:900}}` and replacement cookie.
- **Errors/Audit:** 401 invalid/expired; reuse revokes family and returns `SESSION_COMPROMISED`; audit reuse. No application idempotency key because token rotation itself is single-use.

### 9.4 Create organization

- **Route:** `POST /api/v1/organizations`.
- **Authentication:** Bearer ACTIVE User; no tenant Membership yet; permission is authenticated-user capability.
- **Request:** `legalName`, optional `displayName/slug/locale/invoicePrefix/invoiceNumberPadding/defaultPaymentTermsDays`, required `baseCurrency/timezone`.
- **Validation:** lengths/registries/prefix/padding/terms rules.
- **Domain/Transaction:** create Organization, InvoiceSequence, default categories, OWNER Membership, audit atomically.
- **Idempotency:** recommended `Idempotency-Key`; same contract as commands.
- **Response:** 201 Organization with caller Membership summary.
- **Errors/Audit:** 409 slug/idempotency, 422 invalid registry/business setting; `ORGANIZATION_CREATED`.

### 9.5 Change membership role

- **Route:** `PATCH /organizations/:organizationId/members/:membershipId`.
- **Auth/Tenant/Permission:** ACTIVE membership + `membership.change_role`.
- **Request:** `{role}`; required `If-Match` membership version.
- **Rules/Transaction:** scoped target; Admin cannot target Owner/assign Owner/escalate self; OWNER cannot be changed here; roles are enum; update/audit/invalidation event transaction.
- **Response:** 200 Membership/ETag.
- **Errors:** 404 cross-tenant, 403 policy, 409 stale/OWNER_TRANSFER_REQUIRED.

### 9.6 Create customer

- **Route:** `POST /organizations/:organizationId/customers`.
- **Permission:** `customer.create`.
- **Request:** Prompt 13 follows the existing Prisma model: required `displayName` (visible text, maximum 200), optional nullable `customerCode` (visible text, maximum 50) and `email` (valid email, maximum 320). Values retain their supplied casing and whitespace; no identity-email normalization is applied. Broader conceptual party/contact/address/tax/terms/notes fields require a future reviewed schema migration and are rejected now. Tenant, creator, status, version, IDs, and timestamps are server-owned.
- **Rules/Transaction:** tenant from context; duplicate name/email allowed; code tenant-unique; customer + audit transaction.
- **Response:** 201 Customer with `ETag`, `organizationId`, writable fields, `status`, `createdByUserId`, `version`, and timestamps.
- **Errors:** 400 invalid transport fields; 409 `CUSTOMER_CODE_UNAVAILABLE`; audit `CUSTOMER_CREATED`.

### Prompt 14 implemented Invoice scope

The eight documented Invoice routes are implemented. Writable input follows the
existing Prisma fields: customerId, issueDate, dueDate, discount, taxRate and items.
Optional purchaseOrderReference/notes/terms remain conceptual and are rejected
until a future reviewed migration. Items have a transport bound of 1–1,000.
The focused evidence migration supplies immutable billToName/billToEmail,
issuedByUserId and cancel/void timestamps/reasons; broader Customer snapshots
(address/tax identifier) remain deferred with the broader Customer schema.

Discount FIXED follows currency minor units and NUMERIC(19,6), hence at most
13 integer digits; unit prices retain NUMERIC(19,4) and may use four places.
Decimal syntax errors are 400; semantic money/quantity/discount/tax bounds are 422.
Invalid calendar/date ordering and range input return 400 INVALID_REQUEST.
Required version headers are validated like existing Customer If-Match headers.
Issue accepts an empty/absent body; deletion rejects nonempty bodies. Recommended
invoice idempotency-key replay is deferred, not a required MVP credential: stale
versions/lifecycle conflicts protect retries. Issue persists a versioned ID-only
PendingEvent but dispatch/delivery remains later work.

Lists return full invoice representations, include all statuses by default, use
issueDate desc and the documented sorts/filters. Invoice-number nulls sort last
in both directions. Search uses billToName after issue and current Customer name
for drafts. Overdue cursor signatures include the resolved tenant-local date;
reusing one after that date changes is invalid. DRAFT paymentState is
NOT_APPLICABLE. List responses are current reads, not a historical snapshot.

### 9.7 Create draft invoice

- **Route:** `POST /organizations/:organizationId/invoices`.
- **Permission:** `invoice.create`.
- **Request:** `{customerId,issueDate,dueDate,purchaseOrderReference?,notes?,terms?,discount:{type,value},taxRate,items:[{description,quantity,unitPrice,sortOrder}]}`. At least one item. No currency/status/totals.
- **Rules/Transaction:** customer ACTIVE/same tenant; dates valid; Decimal calculation; set currency from org; lock currency if first finance row; create header/items/calculated results/audit.
- **Idempotency:** recommended for client retry, not required MVP.
- **Response:** 201 full DRAFT Invoice with null number and ETag.
- **Errors:** 404 customer/cross-tenant; 422 money/date/discount/tax/item; audit `INVOICE_CREATED`.

### 9.8 Update draft invoice

- **Route:** `PATCH /organizations/:organizationId/invoices/:invoiceId`.
- **Permission:** `invoice.update_draft`; `If-Match` required.
- **Request:** any writable draft header fields; if `items` is supplied it is the complete replacement ordered list, not a partial item patch.
- **Rules/Transaction:** scoped DRAFT only; same-tenant ACTIVE customer if changed; recalculate all lines/totals; replace/diff items atomically; audit changed allowlist.
- **Response:** 200 DRAFT Invoice/new ETag.
- **Errors:** 404, 409 INVOICE_FINALIZED/CONCURRENT_MODIFICATION, 422 calculations.

### 9.9 Issue invoice

- **Route:** `POST /organizations/:organizationId/invoices/:invoiceId/issue`.
- **Permission:** `invoice.issue`; optional empty body; `If-Match` required.
- **Rules/Transaction:** lock draft and tenant sequence, verify customer/snapshot, recompute, require total >0, allocate non-reused number, freeze/issue/audit/pending event.
- **Idempotency:** recommended; if already issued and same completed key, replay; otherwise INVALID_INVOICE_STATE.
- **Response:** 200 issued Invoice.
- **Errors:** 404, 409 lifecycle/stale/rare number conflict/idempotency, 422 invalid draft.

### Prompt 15 implemented Payment scope

Exactly four routes are implemented: record, tenant collection GET, item GET and
reverse. Record accepts only `{amount,paymentDate,method}`; reference/notes are
conceptual fields absent from Prisma and rejected, including reference search.
Unknown fields and client totals/currency/status/actors/timestamps are rejected.
There is no invoice-specific GET collection, Payment PATCH/DELETE or partial
reversal API. Every response includes immutable Payment facts, server actors and
timestamps, nullable full reversal detail, and an Invoice financial summary.
Detail/list summaries reflect current settlement; command retries return the
original command receipt.

Amounts are positive decimal strings, at most 15 integer/4 fractional digits,
obeying effective currency minor units without rounding a payment. Dates are real
YYYY-MM-DD dates; no additional before/future date restriction is introduced.
Reversal reason is nonblank, trimmed, maximum 500 characters. Neither command
requires If-Match; both increment Invoice version. Cache drift is rejected as
409 INVOICE_SETTLEMENT_INCONSISTENT before financial mutation.

Lists support invoiceId/status/method/paymentDateFrom/To, sortBy
paymentDate/recordedAt/amount, sortOrder, limit 1–100 (default 25), and after;
default paymentDate desc. Inclusive list date spans are bounded to 1,825 days.
Cursors bind tenant, filters and sort and use id ties. OWNER/ADMIN/ACCOUNTANT
have all three Payment permissions; MEMBER/VIEWER have none, including read.

### 9.10 Record payment

- **Route:** `POST /organizations/:organizationId/invoices/:invoiceId/payments`.
- **Permission:** `payment.create`.
- **Headers/request:** `Idempotency-Key` required; `{amount,paymentDate,method}` (reference/notes deferred). No currency/balance/status.
- **Rules/Transaction:** scoped ISSUED invoice; lock invoice; recompute active sum; validate currency-scale amount <= remaining; insert Payment/update caches/audit/event/idempotency atomically.
- **Response:** 201 Payment plus `{invoice:{id,paymentState,amountPaid,balanceDue,version}}`. A successful replay returns the original HTTP status/body semantics and header `Idempotency-Replayed: true`.
- **Errors:** 400 missing/invalid key; 404 invoice; 409 state/idempotency mismatch; 422 invalid/overpayment. Concurrent losing request receives 422 PAYMENT_EXCEEDS_BALANCE, never a lock error.

### 9.11 Reverse payment

- **Route:** `POST /organizations/:organizationId/payments/:paymentId/reverse`.
- **Permission:** `payment.reverse`.
- **Request:** `{reason,reversalDate}`; no amount because full-only. `Idempotency-Key` required for public API.
- **Rules/Transaction:** lock Invoice then RECORDED Payment; create unique full PaymentReversal; mark reversed; recompute cache; audit/event/idempotency.
- **Response:** 200 Payment with reversal and updated invoice settlement summary.
- **Errors:** 400 malformed/blank reason or missing/invalid key, 404, 409 already reversed/state/idempotency/cache drift, 422 invalid calendar date. Audit `PAYMENT_REVERSED`.

### 9.12 Create expense

- **Route:** `POST /organizations/:organizationId/expenses`.
- **Permission:** `expense.create`.
- **Request:** `{categoryId,vendorPayee?,amount,expenseDate,description,reference?,notes?}`. Currency comes from org.
- **Rules/Transaction:** ACTIVE same-tenant category; positive currency-scale amount; set currency lock if needed; Expense + audit atomically.
- **Idempotency:** recommended for retry/import.
- **Response:** 201 ACTIVE Expense/ETag.
- **Errors:** 404 category/cross-tenant; 422 value/date; audit `EXPENSE_CREATED`.

### 9.13 Cash flow

- **Route:** `GET /organizations/:organizationId/cash-flow?fromDate&toDate&groupBy=day|week|month`.
- **Permission:** `analytics.read`.
- **Rules:** inclusive tenant business dates, max 366; inflows RECORDED payments, outflows ACTIVE expenses, no invoice-issue effect. Group boundaries use organization timezone/calendar.
- **Response:** `data:{inflows,outflows,netCashFlow,series:[...]}, meta:{fromDate,toDate,groupBy,currency,timezone,basis:"cash"}`; decimals strings.
- **Errors/Audit:** 400 range/group; read normally not audited.

### 9.14 Simplified P&L

- **Route:** `GET /organizations/:organizationId/profit-loss?fromDate&toDate&groupBy=none|month`.
- **Permission:** `analytics.read`.
- **Rules:** collected RECORDED payments minus ACTIVE paid expenses; not statutory accounting.
- **Response:** `data:{revenue,expenses,netResult,expenseByCategory,series?}, meta:{...,basis:"SIMPLIFIED_CASH",disclaimer:"Not a GAAP/IFRS financial statement."}`.
- **Errors:** 400 invalid range/group; decimals exact.

### 9.15 Analytics summary

- **Route:** `GET /organizations/:organizationId/analytics/summary?fromDate&toDate&asOfDate`.
- **Permission:** `analytics.read`.
- **Rules:** uses documented issue/payment/expense/cohort dates; `asOfDate` defaults tenant today and cannot precede fromDate for cohort metrics.
- **Response:** bounded sections: `billing` (totalInvoiced, invoice counts), `collections` (collected, rate, average delay/sample), `receivables` (outstanding, overdue), `spending` (expenses), `cash` (netCashFlow/netResult), `customers` (activeCount), plus currency/timezone/range/asOf definitions.
- **Errors:** 400/422 invalid range/asOf. Do not combine unrelated raw registers.

## 10. Compact module contracts

### Organizations

- `GET /organizations` returns ACTIVE membership summaries; no tenant context/permission because it establishes selectable tenants.
- `GET /organizations/:id` requires `organization.read`.
- `PATCH /organizations/:id` requires `organization.update`, `If-Match`, only settings fields. Currency change after lock returns 409.
- `POST /organizations/:id/close` is OWNER-only `organization.close`, requires `{reason}`, recent authentication, transaction/audit, returns 200 CLOSED Organization. No DELETE endpoint.
- `POST /organizations/:id/transfer-ownership` requires `organization.transfer_ownership`, recent authentication, `{targetMembershipId}`, idempotency key recommended; target ACTIVE, transaction locks memberships; returns both summaries.

### Memberships/invitations

- Member list filters `status,role`; only `membership.read`.
- Invite request `{email,role,expiresInDays?}`; role cannot OWNER; permission `membership.invite`; 201 Invitation safe fields (never token hash; raw invite token is returned only in a protected development delivery response if email provider is disabled, and must not be logged).
- Invitation list/revoke require membership management permission; revoke DELETE returns 204 and audits.
- `POST /invitations/accept` requires authenticated User and `{token}`; token/email bind; 200 Membership. Invalid/expired/used all return 410.
- Suspend/reactivate/remove require matching permissions, scoped target, contextual Owner protection, version (`If-Match`), transaction/audit. Remove returns 204 but sets REMOVED.

### Customers

- Detail GET `customer.read`; PATCH `customer.update` with `If-Match`; archive command `customer.archive` returns 200 ARCHIVED Customer or 204 by implementation choice—**contract decision: 200 resource**.
- Archive is idempotent; archived customer update is allowed only for safe correction with permission, but it cannot be used for new invoices.
- Prompt 13 implements collection POST/GET, detail GET/PATCH, and archive POST only. There is no restore or delete route. PATCH accepts the same three writable fields, requires at least one field, and can clear code/email with `null`. Code uniqueness spans active and archived customers. Successful PATCH increments version and writes `CUSTOMER_UPDATED` atomically; stale versions return 409 `CONCURRENT_MODIFICATION`.
- Archive accepts an empty object, changes ACTIVE to ARCHIVED, increments version, and writes `CUSTOMER_ARCHIVED` in the same transaction. Repeated/concurrent archive of an already archived customer returns the retained resource without another version increment or audit event. Archived details remain readable and the same metadata fields remain correctable.
- Lists return the section 3 collection envelope and bounded cursor pagination. Cursors bind their version/sort tuple to the trusted tenant, status, search, and sort; changing those returns 400 `INVALID_CURSOR`. Cursors are untrusted pagination positions, never credentials or tenant authority. A changing dataset is not a historical snapshot.

### Invoices

- List/detail require `invoice.read`; query filters follow section 3.
- `DELETE /invoices/:id` requires `invoice.delete_draft`, `If-Match`, returns 204; only DRAFT.
- Cancel request `{reason}`, permission `invoice.cancel`, requires zero Payment rows ever; returns 200 CANCELLED Invoice.
- Void request `{reason}`, permission `invoice.void`, requires zero RECORDED payments; returns 200 VOID Invoice. Both lock invoice, audit, and are recommended idempotent.

### Payments

- List/detail require `payment.read`; list may filter invoice/status/method/date. Reference search is deferred.
- There is no payment PATCH/DELETE, allocation, refund, or batch-payment endpoint.

### Expense categories and expenses

- Category list uses `expense.read`; create/update/archive use `expense_category.manage`; tenant-unique normalized name.
- Expense detail/list uses `expense.read`; PATCH requires `expense.update`, `If-Match`, ACTIVE only; void command requires `expense.void`, `{reason}`, `If-Match`, returns 200 VOIDED Expense. No DELETE.

### Reports and exports

- Preview GET endpoints require `report.read`, accept the relevant register filters and bounded date range, and return paginated JSON, not CSV.
- `POST /reports/exports` requires `report.export`, recommended Idempotency-Key, request `{reportType,format:"CSV",parameters}`; server injects tenant/user, validates range, creates PENDING ReportExport + audit/event, returns 202.
- Export collection/item require `report.export`. Download requires READY/unexpired and current permission; cross-tenant is 404; not ready 409 `EXPORT_NOT_READY`; expired 410. Successful external contract is 200 streamed CSV with safe filename and content disposition (storage may use an internal redirect). Download is audited.

### Notifications and audit

- Notification list and read/archive commands apply only to recipient User even within tenant. Read/archive are idempotent; no create public endpoint.
- Audit list is read-only, requires `audit.read`, cursor-paginated and filterable. No public POST/PATCH/DELETE. Safe before/after metadata is returned only as stored/redacted.

## 11. Payment idempotency header

`Idempotency-Key` is required on payment create/reverse and recommended where marked. It is 16–128 printable ASCII characters with sufficient unpredictability; whitespace/control characters are rejected. Scope is authorized organization + User + stable operation + key. The canonical hash includes route resource, validated body, normalized decimal strings, and effective tenant—not raw JSON order.

- First request executes and stores result reference/status in the transaction.
- Same scope/key/hash returns the same logical result, does not repeat audit/event, and adds `Idempotency-Replayed: true`.
- Same scope/key with different hash returns 409 `IDEMPOTENCY_CONFLICT`.
- A failed/rolled-back mutation leaves no claim. Retention defaults to at least 30 days for payments; no cleanup is implemented, and retained expired keys still replay.
- Implemented claims store only Payment reference/status. Immutable audit financial receipts and immutable Payment/Reversal facts reconstruct the original status/body, including original Invoice settlement and timestamps after later payments, reversal or void. Replay rechecks current authorization and repeats no audit/event. Concurrent identical keys execute once; conflicting hashes return 409 after the winner commits.

## 12. Endpoint authorization matrix

Abbreviations: A=authentication; M=ACTIVE tenant membership; I=idempotency; Tx=database transaction; Au=audit. “Rec” means recommended. Within this matrix, `/:orgId` is a compact alias for the exact prefix `/organizations/:organizationId`; it is not a separate route style.

| Method | Route | Module | A | M | Permission | I | Tx | Au | Key rule |
|---|---|---|:---:|:---:|---|---|:---:|:---:|---|
| POST | `/auth/register` | Auth | — | — | — | — | ✓ | security | User only |
| POST | `/auth/login` | Auth | — | — | — | — | ✓ | security | Generic credentials |
| POST | `/auth/refresh` | Auth | cookie | — | — | rotation | ✓ | on reuse | Single-use rotation |
| POST | `/auth/logout` | Auth | access or refresh | — | — | — | ✓ | security | Revoke current session |
| POST | `/auth/logout-all` | Auth | ✓ | — | — | — | ✓ | security | Revoke all |
| GET | `/me` | Users | ✓ | — | — | — | — | — | Safe profile |
| GET/POST | `/organizations` | Org | ✓ | — | list/create capability | POST rec | POST ✓ | POST ✓ | Explicit tenant creation |
| GET/PATCH | `/organizations/:orgId` | Org | ✓ | ✓ | `organization.read/update` | — | PATCH ✓ | PATCH ✓ | If-Match update |
| POST | `/:orgId/close` | Org | ✓ | ✓ | `organization.close` | Rec | ✓ | ✓ | Owner/recent auth |
| POST | `/:orgId/transfer-ownership` | Org | ✓ | ✓ | `organization.transfer_ownership` | Rec | ✓ | ✓ | Target ACTIVE |
| GET | `/:orgId/members` | Membership | ✓ | ✓ | `membership.read` | — | — | — | Scoped list |
| POST/GET | `/:orgId/invitations` | Membership | ✓ | ✓ | `membership.invite/read` | Rec/— | POST ✓ | POST ✓ | Cannot OWNER |
| DELETE | `/:orgId/invitations/:id` | Membership | ✓ | ✓ | `membership.invite` | — | ✓ | ✓ | Revoke only scoped |
| POST | `/invitations/accept` | Membership | ✓ | token | — | token | ✓ | ✓ | Email-bound token |
| PATCH | `/:orgId/members/:id` | Membership | ✓ | ✓ | `membership.change_role` | — | ✓ | ✓ | Owner safeguards |
| POST | `/:orgId/members/:id/suspend|reactivate` | Membership | ✓ | ✓ | `membership.suspend` | — | ✓ | ✓ | No Owner |
| DELETE | `/:orgId/members/:id` | Membership | ✓ | ✓ | `membership.remove` | — | ✓ | ✓ | Sets REMOVED |
| POST/GET | `/:orgId/customers` | Customer | ✓ | ✓ | `customer.create/read` | Rec/— | POST ✓ | POST ✓ | Tenant from context |
| GET/PATCH | `/:orgId/customers/:id` | Customer | ✓ | ✓ | `customer.read/update` | — | PATCH ✓ | PATCH ✓ | Scoped/If-Match |
| POST | `/:orgId/customers/:id/archive` | Customer | ✓ | ✓ | `customer.archive` | — | ✓ | ✓ | Preserve history |
| POST/GET | `/:orgId/invoices` | Invoice | ✓ | ✓ | `invoice.create/read` | Rec/— | POST ✓ | POST ✓ | Server totals |
| GET/PATCH/DELETE | `/:orgId/invoices/:id` | Invoice | ✓ | ✓ | read/update_draft/delete_draft | — | mutation ✓ | mutation ✓ | Draft-only mutations |
| POST | `/:orgId/invoices/:id/issue` | Invoice | ✓ | ✓ | `invoice.issue` | Rec | ✓ | ✓ | Lock sequence |
| POST | `/:orgId/invoices/:id/cancel` | Invoice | ✓ | ✓ | `invoice.cancel` | Rec | ✓ | ✓ | No payment rows |
| POST | `/:orgId/invoices/:id/void` | Invoice | ✓ | ✓ | `invoice.void` | Rec | ✓ | ✓ | No active payments |
| POST | `/:orgId/invoices/:id/payments` | Payment | ✓ | ✓ | `payment.create` | **Req** | ✓ | ✓ | Lock/recompute balance |
| GET | `/:orgId/payments[/:id]` | Payment | ✓ | ✓ | `payment.read` | — | — | — | Scoped read |
| POST | `/:orgId/payments/:id/reverse` | Payment | ✓ | ✓ | `payment.reverse` | **Req** | ✓ | ✓ | Full once |
| GET/POST | `/:orgId/expense-categories` | Expense | ✓ | ✓ | expense.read/category.manage | —/Rec | POST ✓ | POST ✓ | Active tenant category |
| PATCH/POST | `/:orgId/expense-categories/:id[/archive]` | Expense | ✓ | ✓ | `expense_category.manage` | — | ✓ | ✓ | Archive referenced |
| POST/GET | `/:orgId/expenses` | Expense | ✓ | ✓ | `expense.create/read` | Rec/— | POST ✓ | POST ✓ | Paid expense |
| GET/PATCH | `/:orgId/expenses/:id` | Expense | ✓ | ✓ | `expense.read/update` | — | PATCH ✓ | PATCH ✓ | ACTIVE/If-Match |
| POST | `/:orgId/expenses/:id/void` | Expense | ✓ | ✓ | `expense.void` | Rec | ✓ | ✓ | Terminal |
| GET | `/:orgId/cash-flow` | Analytics | ✓ | ✓ | `analytics.read` | — | — | — | Actual cash only |
| GET | `/:orgId/profit-loss` | Analytics | ✓ | ✓ | `analytics.read` | — | — | — | Simplified cash basis |
| GET | `/:orgId/analytics/*` | Analytics | ✓ | ✓ | `analytics.read` | — | — | — | Defined cohorts |
| GET | `/:orgId/reports/*` | Reports | ✓ | ✓ | `report.read` | — | — | — | JSON previews |
| POST | `/:orgId/reports/exports` | Reports | ✓ | ✓ | `report.export` | Rec | ✓ | ✓ | 202 async |
| GET | `/:orgId/report-exports[/:id]` | Reports | ✓ | ✓ | `report.export` | — | — | — | Scoped state |
| GET | `/:orgId/report-exports/:id/download` | Reports | ✓ | ✓ | `report.export` | — | — | ✓ | Ready/private |
| GET/POST | `/:orgId/notifications[/:id/read|archive]` | Notification | ✓ | ✓ | notification self perms | — | mutation ✓ | — | Recipient only |
| GET | `/:orgId/audit-logs` | Audit | ✓ | ✓ | `audit.read` | — | — | optional read audit | Immutable |
| GET | `/health/live|ready` | Health | — | — | — | — | — | — | Minimal data |

## 13. API security invariants

1. Route/body organization ID never establishes authorization.
2. Every tenant resource query contains trusted organization ID and resource ID.
3. DTOs expose only writable properties and reject unknowns.
4. Client totals, balances, financial status, actor, timestamps, and job state are never authoritative.
5. Permission checks precede privileged service commands; contextual/domain rules still execute.
6. Cross-tenant and nonexistent resources are indistinguishable 404.
7. Role/permission is loaded from current Membership, not JWT.
8. Export generation/download and background jobs remain tenant-scoped.
9. Audit actor comes only from authenticated context.
10. Payment uses required idempotency plus transaction/row lock.
11. Logs/errors do not contain credentials, card data, PII-rich bodies, or internals.
12. CORS origins, headers, and credential use are explicit; production never uses wildcard credentialed CORS.

## 14. Request IDs, audit, and OpenAPI readiness

A valid inbound `X-Request-Id` may be propagated; otherwise the server generates one. It is returned in response and error, logs, audit, and post-commit event. Never trust it as unique/security evidence.

Audit all organization changes/close/transfer, invitations/member changes, customer create/update/archive, invoice create/update/issue/delete/cancel/void, payment create/reverse, expense/category create/update/archive/void, report export/download, and authentication security events. Actor fields come from context, never body.

Every implemented endpoint must later publish OpenAPI operation summary, auth scheme, parameters, request schema, success schema, shared error/validation schemas, enums, decimal-string formats/examples, cursor metadata, idempotency/If-Match headers, and all expected statuses. The generated spec is contract-tested; this document remains the semantic source until implementation review promotes OpenAPI.

## 15. Future API test plan

### Authentication/authorization

- Registration/login/refresh/logout cases from the authorization document; role matrix and immediate role/status change behavior.
- Unauthenticated, non-member, suspended/removed member, insufficient role, and Owner-only denial.

### Tenant isolation

- A cannot read/update B Customer, attach B Customer, retrieve B Invoice UUID, pay B Invoice, use B Category, view B analytics/audit/notification, or download B export.
- Route tenant change and injected body `organizationId` cannot bypass context.

### Financial/API contract

- Client subtotal/total/amountPaid/balance/status/issuedAt and unknown nested fields are rejected.
- Exact decimal strings round and serialize consistently; JSON numeric money fails.
- Partial/full payments update response state; overpayment gets 422; identical retry replays; changed retry conflicts; concurrent race yields one success.
- Reversal reopens balance and returns original/reversal without allowing partial amount.
- Issued invoice PATCH/DELETE fails; cancel/void preconditions differ correctly.
- Cash-flow/P&L dates, states, currency, and disclaimers reconcile to source facts.

### Protocol

- Cursor/filter/sort whitelists, stale/mismatched cursor, maximum limit/range, If-Match stale version, error shape/request ID, 404 non-enumeration, rate headers, CORS/cookie behavior, CSV injection escaping, and download authorization.

# Prompt 3 API Review Checklist

- [ ] Base API path is defined
- [ ] API versioning is defined
- [ ] Organization route strategy is defined
- [ ] organizationId is never trusted by itself
- [ ] Authentication endpoints are finalized
- [ ] Access token claims are finalized
- [ ] Refresh rotation is defined
- [ ] Logout/revocation behavior is defined
- [ ] Role definitions are consistent
- [ ] Permission names are finalized
- [ ] Role-permission matrix is documented
- [ ] Endpoint authorization matrix is documented
- [ ] Customer API contract is defined
- [ ] Invoice API contract is defined
- [ ] Payment API contract is defined
- [ ] Payment idempotency is defined
- [ ] Expense API contract is defined
- [ ] Cash-flow API contract is defined
- [ ] P&L API contract is defined
- [ ] Analytics API contract is defined
- [ ] Reports API contract is defined
- [ ] Audit API contract is defined
- [ ] Pagination/filtering/sorting conventions are finalized
- [ ] Date semantics are finalized
- [ ] Decimal serialization is finalized
- [ ] Error shape is finalized
- [ ] Validation error shape is finalized
- [ ] HTTP status mapping is finalized
- [ ] Cross-tenant existence leakage is addressed
- [ ] No application code has been generated
