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

Prompt 17 implementation: each omitted date bound defaults to the current
organization-local calendar month's corresponding boundary. `groupBy` defaults
to `month`; only `day`, `week`, and `month` are accepted. The limit counts
inclusive calendar dates (366 is valid; 367 is not). Weeks start on ISO Monday.
Only populated buckets are returned, in ascending order, with
`{periodStart,inflows,outflows,netCashFlow}`. `periodStart` is the natural bucket
start as YYYY-MM-DD; a partial first week/month can start before `fromDate`, but
only facts inside the requested range contribute. Empty ranges return currency-
scaled zero totals and `series:[]`.

Reports use current RECORDED Payment and ACTIVE Expense states in a read-only
repeatable-read PostgreSQL transaction. Reversed payments are excluded even when
their reversal date is outside the range; reversal rows are never subtracted
again. Voided expenses are excluded and archived categories do not remove active
expenses. This is a current-state report, not a retained historical snapshot.
Amounts use Decimal and serialize at organization currency scale, including
negative net values and sums exceeding individual-record limits. A selected
mixed-currency fact fails safely with 422 `CURRENCY_MISMATCH`. No opening/closing
bank balance, audit write, PendingEvent, cache, or queue is introduced.

### 9.14 Simplified P&L

- **Route:** `GET /organizations/:organizationId/profit-loss?fromDate&toDate&groupBy=none|month`.
- **Permission:** `analytics.read`.
- **Rules:** collected RECORDED payments minus ACTIVE paid expenses; not statutory accounting.
- **Response:** `data:{revenue,expenses,netResult,expenseByCategory,series?}, meta:{...,basis:"SIMPLIFIED_CASH",disclaimer:"Not a GAAP/IFRS financial statement."}`.
- **Errors:** 400 invalid range/group; decimals exact.

Prompt 18 implementation: each omitted bound uses the organization-local current
month, and `groupBy` defaults to `month` to match Cash Flow. Only `none` and
`month` are supported; day/week/year are rejected. The maximum range is 366
inclusive calendar dates. Monthly series contain
`{periodStart,revenue,expenses,netResult}` for populated months in chronological
order; natural month starts label partial periods, but only in-range facts count.
`groupBy=none` omits `series`. Empty reports return currency-scaled zero totals,
`expenseByCategory:[]`, and `series:[]` only for monthly grouping.

Category entries are `{categoryId,categoryName,amount}`, ordered by current name
then ID. Only categories with eligible ACTIVE expenses appear; archived categories
remain included and labels reflect current names, not historical name snapshots.
Revenue, expenses, netResult, series and category amounts are Decimal strings at
the organization currency scale. Metadata echoes fromDate/toDate/groupBy/currency/
timezone, basis `SIMPLIFIED_CASH`, and disclaimer
`Not a GAAP/IFRS financial statement.`. The financial result is exposed as
`netResult`, not an alternate `profit` field.

The Financial reader reuses canonical Cash Flow aggregates and currency checks,
then groups categories in PostgreSQL on the same read-only repeatable-read
transaction client. RECORDED Payments use paymentDate; ACTIVE Expenses use
expenseDate. REVERSED/VOIDED rows are excluded by current state, without separately
subtracting reversal rows; invoice totals never contribute. Mixed selected
currencies fail safely with 422 CURRENCY_MISMATCH. Reads create no audits, events,
jobs, financial write records, or persisted report snapshots.

### 9.15 Analytics summary

- **Route:** `GET /organizations/:organizationId/analytics/summary?fromDate&toDate&asOfDate`.
- **Permission:** `analytics.read`.
- **Rules:** uses documented issue/payment/expense/cohort dates; `asOfDate` defaults tenant today and cannot precede fromDate for cohort metrics.
- **Response:** bounded sections: `billing` (totalInvoiced, invoice counts), `collections` (collected, rate, average delay/sample), `receivables` (outstanding, overdue), `spending` (expenses), `cash` (netCashFlow/netResult), `customers` (activeCount), plus currency/timezone/range/asOf definitions.
- **Errors:** 400/422 invalid range/asOf. Do not combine unrelated raw registers.

Prompt 19 implementation: summary accepts only fromDate/toDate/asOfDate. Omitted
range bounds use the organization-local current month (max 366 inclusive dates);
asOfDate defaults to tenant today and cannot precede fromDate. No grouping,
comparison, trend, or previous-period query is supported.

Response data has these exact bounded sections:

- billing: totalInvoiced and invoiceCounts {DRAFT,ISSUED,CANCELLED,VOID}.
- collections: collected, rate, averagePaymentDelayDays, sampleSize.
- receivables: outstanding, overdue.
- spending: expenses.
- cash: netCashFlow, netResult (the same simplified cash-basis result).
- customers: activeCount.

Total invoiced sums CURRENT ISSUED invoices by issueDate in range. Lifecycle counts
use all four current statuses in that issue-date range. Collected/expenses/cash
reuse Cash Flow's paymentDate/expenseDate range totals. Collection rate is the
percentage of RECORDED payments through asOfDate allocated to the CURRENT ISSUED
issue-date cohort, divided by its total, with four decimal places; a zero cohort
denominator returns null. It is not period collected divided by period invoiced.
Average delay uses only positive-total fully paid cohort invoices through asOfDate:
average(max eligible paymentDate - dueDate), with two decimal places and sampleSize.
Early payment is negative; no paid sample returns null.

Receivables cover all CURRENT ISSUED invoices with issueDate <= asOfDate,
independent of the selected billing cohort. Balance is invoice total minus
RECORDED receipts with paymentDate <= asOfDate, recomputed from source rows rather
than cached balanceDue. Only positive balances contribute. Overdue requires
dueDate < asOfDate; due today and fully paid invoices are not overdue. Active
customer count is query-time ACTIVE, independent of range; archived customers do
not remove otherwise eligible invoice claims. Invoice VOID is the actual enum;
Expense terminal status remains VOIDED.

Metadata echoes dates/currency/timezone and basis CURRENT_STATE, with named
receivablesBasis, collectionRateBasis, collectionRateUnit:PERCENT,
paymentDelayBasis, cashBasis, and customerCountBasis definitions. Amounts are
currency-scaled Decimal strings, ratios/delays Decimal strings, and counts integers.
Empty reports contain zero amounts/counts and null rate/delay. All sections share
one read-only repeatable-read transaction; no audit/event/job/model is written.
Mixed selected currencies return safe 422 CURRENCY_MISMATCH and invalid source
settlement returns 409 INVOICE_SETTLEMENT_INCONSISTENT. Invalid input is 400.

### 9.16 Receivables aging (Prompt 19)

- Route: GET /organizations/:organizationId/analytics/receivables-aging.
- Permission: analytics.read; query only asOfDate (default organization-local today).
- Same eligible receivable/source-balance rules as summary; no range/cohort filter.
- Response data: {outstanding,overdue,buckets:[{bucket,invoiceCount,amount}]}.
- Five ordered buckets: CURRENT (due today/future), 1_30, 31_60, 61_90, 91_PLUS.
  Age is asOfDate - dueDate in calendar days. Only positive balances are counted;
  empty buckets remain zero. Amounts reconcile to outstanding and overdue.
- Metadata: asOfDate/currency/timezone/basis:CURRENT_STATE/receivablesBasis.
- Authentication, tenant concealment, safe errors and read consistency match summary.

Both analytics routes reflect current corrected states: REVERSED payments and
VOIDED expenses never contribute, regardless of correction date, with no separate
reversal subtraction. asOfDate cuts business-date eligibility; it does not
reconstruct historical recordedAt/reversedAt or invoice lifecycle snapshots.
Historical timestamp reconstruction remains deferred. No schema migration is needed.

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

Prompt 16 implements exactly the nine routes in section 8. Category input is
name/description only (description optional, nonblank, max 500); PATCH is nonempty
and ACTIVE only. Display names trim/collapse whitespace; normalizedName lowercases
using JavaScript locale-independent lowercase, without Unicode transformations.
Both final names are at most 100 characters; tenant uniqueness includes archived
rows. Defaults may archive; systemKey is server-owned and immutable. Repeat archive
returns the unchanged resource with no duplicate audit. Category list supports
status/limit/after only, defaults ACTIVE and orders name asc/id asc.

Expense input is categoryId/amount/expenseDate/description and nullable optional
vendorPayee/reference/notes. PATCH is nonempty; explicit null clears only those
three nullable fields. Bounds: vendor 200, description 500, reference 150, notes
1000, reason 500; text trims and must be nonblank. New Category assignment requires
same-tenant ACTIVE status and a row lock; unchanged archived references remain
valid. Responses include category {id,name,status,systemKey}; money is a currency-
scale string, expenseDate YYYY-MM-DD, version and server actors/void evidence.
Create atomically snapshots and permanently locks Organization currency. Positive
canonical amount strings obey currency minor units without rounding.

Expense lists default ACTIVE/expenseDate desc/id desc; allowed filters/sorts are
in section 3. Vendor matching is literal case-insensitive contains; vendor nulls
sort last in both directions. Inclusive date span max 1,825 days. Category and
Expense cursors bind resource kind, tenant, filters and ordering. Expense detail
includes VOIDED history. PATCH/void use If-Match and return incremented ETags.

Errors: malformed syntax/type/unknown fields 400 VALIDATION_ERROR; impossible
calendar date 422 EXPENSE_INVALID_DATE; invalid semantic money 422 INVALID_MONEY;
foreign/missing resources 404 RESOURCE_NOT_FOUND; stale version 409
CONCURRENT_MODIFICATION; duplicate category 409 EXPENSE_CATEGORY_ALREADY_EXISTS;
archived category PATCH 409 EXPENSE_CATEGORY_NOT_EDITABLE; new inactive assignment
409 EXPENSE_CATEGORY_INACTIVE; VOIDED PATCH 409 EXPENSE_NOT_EDITABLE; fresh repeat
void 409 EXPENSE_ALREADY_VOIDED. Category resource version/ETag is absent.

Mutations emit EXPENSE_CATEGORY_CREATED/UPDATED/ARCHIVED and EXPENSE_CREATED/
UPDATED/VOIDED audits in the same transaction. Notes contents are excluded. No
Expense/Category PendingEvents, request idempotency or business queue is registered.


- Category list uses `expense.read`; create/update/archive use `expense_category.manage`; tenant-unique normalized name.
- Expense detail/list uses `expense.read`; PATCH requires `expense.update`, `If-Match`, ACTIVE only; void command requires `expense.void`, `{reason}`, `If-Match`, returns 200 VOIDED Expense. No DELETE.

### Reports and exports

- Preview GET endpoints require `report.read`, accept the relevant register filters and bounded date range, and return paginated JSON, not CSV.
- `POST /reports/exports` requires `report.export`, recommended Idempotency-Key, request `{reportType,format:"CSV",parameters}`; server injects tenant/user, validates range, creates PENDING ReportExport + audit/event, returns 202.
- Export collection/item require `report.export`. Download requires READY/unexpired and current permission; cross-tenant is 404; not ready 409 `EXPORT_NOT_READY`; expired 410. Successful external contract is 200 streamed CSV with safe filename and content disposition (storage may use an internal redirect). Download is audited.

Prompt 21 implements exactly four previews and four export routes under
`/organizations/:organizationId`. Preview paths are `reports/invoices`,
`reports/payments`, `reports/expenses`, and `reports/receivables`. Export creation
is POST `reports/exports`; GET collection/detail/download paths are
`report-exports`, `report-exports/:exportId`, and `report-exports/:exportId/download`.

Approved types and parameters (unknown fields are rejected):

| reportType | parameters | Source/output |
|---|---|---|
| INVOICE_REGISTER | fromDate, toDate, asOfDate, customerId, status (DRAFT/ISSUED/CANCELLED/VOID) | Issue-date cohort; current lifecycle, immutable bill-to name where issued, authoritative recorded receipts through asOfDate, balance, overdue |
| PAYMENT_REGISTER | fromDate, toDate, invoiceId | Current RECORDED receipts by paymentDate |
| EXPENSE_REGISTER | fromDate, toDate, expenseCategoryId, vendorPayee (exact match) | Current ACTIVE paid expenses by expenseDate, including archived category references |
| RECEIVABLES | asOfDate | Canonical five aging buckets, counts and monetary amounts from Analytics |
| CASH_FLOW | fromDate, toDate, groupBy (day/week/month; default month) | Canonical cash TOTAL and PERIOD rows |
| CASH_BASIS_PERFORMANCE | fromDate, toDate, groupBy (none/month; default month) | Canonical cash-basis TOTAL, optional PERIOD and CATEGORY rows |

Date ranges default to the organization-local current month, with at most 366
inclusive dates. asOfDate defaults to tenant-local today; invoice asOfDate cannot
precede fromDate. Receivables uses an as-of cutoff rather than a period range.
All semantics use current source state, not historical database reconstruction.
Preview filters match the corresponding type's parameters, plus limit (25,
maximum 100) and after. Registers sort by id ascending; aging uses the fixed
CURRENT, 1_30, 31_60, 61_90, 91_PLUS order. Cursors bind tenant/type/normalized
filters. Responses are `{data:[rows],meta:{...parameters,currency,timezone,
basis:"CURRENT_STATE",limit,hasMore,nextCursor}}`.

Export list accepts limit/after/status/reportType, sorting createdAt/id descending;
response meta is `{limit,hasMore,nextCursor}`. Detail/create return `{data:export}`.
Export metadata includes id, organizationId, reportType, format, parameters,
status, rowCount (string/null), errorCode (FAILED only), completedAt, expiresAt,
createdAt and updatedAt. No requester ID, internal retry marker, checksum, or
storage path/key is exposed. Download filename is server-controlled
`<lowercase_report_type>-<exportId>.csv`.

Idempotency-Key is optional/recommended on creation. Same authorized scope/key
and normalized intent returns the same export ID with its current lifecycle
metadata and `Idempotency-Replayed: true`; changed intent is 409. This status
resource replay intentionally differs from immutable payment receipt replay.
Requests without keys may create separate exports. Creation audit action is
`report.export.request`; successful artifact release uses `report.export.download`.

All requested exports run asynchronously. CSV is UTF-8 with CRLF records,
deterministic type-specific headers, trusted Decimal strings, and formula
neutralization for user text. Exports are bounded to 10,000 data rows and 10 MiB;
oversized output durably fails with REPORT_TOO_LARGE, never truncates.
Development storage is a private local adapter; API and worker must share its
directory. REPORT_STORAGE_DIRECTORY defaults to `.private/reports` (git-ignored).
REPORT_EXPIRY_HOURS defaults to 24 from completion (configurable 1–168 hours).
These are documented development defaults where earlier requirements omitted
a concrete policy. Authorized metadata/download access lazily persists EXPIRED;
metadata and files remain retained. No retention/deletion scheduler is added.
Missing/corrupt ready artifacts return 503 EXPORT_ARTIFACT_UNAVAILABLE.

### Notifications and audit

- Notification list and read/archive commands apply only to recipient User even within tenant. Read/archive are idempotent; no create public endpoint.
- Prompt 20 implements GET /organizations/:organizationId/notifications with
  notification.read; queries are limit (25, max 100), after, status
  (UNREAD/READ/ARCHIVED), sortBy (createdAt only), sortOrder (desc default).
  Default inbox includes UNREAD and READ; ARCHIVED is explicit. Sort ties use id.
  Cursors bind tenant, recipient, status and direction; response meta is
  {limit,nextCursor,hasMore}, without an expensive total count.
- POST /organizations/:organizationId/notifications/:notificationId/read and
  /archive require notification.update_self and an empty body. Both return 200
  {data:notification}. No If-Match or Idempotency-Key is required. Read moves UNREAD
  to READ once; archive is terminal. Repeated commands preserve original timestamps,
  and reading an archived row does not restore it.
- Each notification exposes id, organizationId, type, status, title, body,
  relatedEntityType/Id, scheduledAt/readAt/archivedAt, createdAt/updatedAt. Internal
  recipient IDs, dedupe keys and metadata are not exposed. Related IDs never grant
  access to the related resource. All canonical roles have self-notification permissions.
- Missing/inactive tenant membership and foreign or other-recipient notification IDs
  are concealed as 404. Missing/disabled authentication is 401; permission denial is
  403; invalid/unknown fields or cursors are 400. Ordinary inbox reads and self-state
  commands create no financial audit or PendingEvent. No public create, manual-send,
  bulk-read, preferences, deletion or reminder-management route is introduced.
- Audit list is implemented in Prompt 22 as specified below.

### Audit logs (Prompt 22)

`GET /api/v1/organizations/:organizationId/audit-logs` requires current ACTIVE
membership and `audit.read` (OWNER, ADMIN, ACCOUNTANT in the canonical role map).
It returns `{data: [...], meta: {limit, nextCursor, hasMore}}`; an empty result is
200 with `data: []`, `nextCursor: null`, and `hasMore: false`. There is no detail,
mutation, export, or metadata-search route.

Allowlisted query parameters:

| Parameter | Meaning |
|---|---|
| `limit` | 1–100, default 25 |
| `after` | Opaque versioned cursor bound to organization, resolved filters and sort |
| `sortBy` | `occurredAt` only, also the default |
| `sortOrder` | `asc` or `desc`, default `desc`; ID tie-breaker uses the same direction |
| `actorUserId` | Exact UUID actor match |
| `action` | Exact stored action string, 1–100 characters; no action renaming |
| `entityType` | Exact stored entity type, 1–50 characters |
| `entityId` | Exact UUID historical entity match; no current-resource existence check |
| `occurredFrom`, `occurredTo` | Optional real `YYYY-MM-DD` calendar-day bounds on `occurredAt` |

As section 3 specifies for instant filters, audit date bounds use the current
organization timezone: inclusive local start of `occurredFrom`, exclusive local
start of the day following `occurredTo`. This filters stored UTC audit instants,
not invoice/payment/expense business dates. Either bound may be omitted; there
is no implicit current-month filter. Two-sided ranges include at most 1,825
calendar days. `occurredTo=9999-12-31` is rejected because its next-day boundary
exceeds the four-digit date contract. DST and skipped local dates are handled.
Changing resolved bounds, tenant, other filters or sort invalidates a cursor;
changing page size is allowed. Cursors convey position, never authorization.
Pages are not a persistent historical snapshot: new records ahead of a descending
cursor appear on a fresh listing, while existing tied rows paginate by timestamp/ID.
Unsupported, repeated, or malformed fields return 400; malformed or mismatched
cursor positions return `INVALID_CURSOR`; transport DTO errors use the existing
`VALIDATION_ERROR` shape and domain range errors use `INVALID_REQUEST`.
`requestId` is returned but is not an accepted filter.
Nonmembers/inactive memberships are concealed as 404; an active
member without permission receives 403; missing/invalid authentication receives 401.

Each entry exposes `id`, `organizationId`, `actorType`, nullable `actorUserId` and
`actorMembershipId`, `action`, `entityType`, `entityId`, `outcome`, `source`, UTC ISO
`occurredAt`, nullable `requestId`/`correlationId`, `changedFields`, `beforeData`,
`afterData`, and `metadata`. Actor IDs are historical references, without user
enrichment. SYSTEM/WORKER rows retain null actor IDs; global auth rows with null
organization are excluded. Archived/deleted entities do not hide audit history.

Before/after data is a read-time projection of existing writer allowlists:
organization settings/status/ownership; membership role/status; invitation
email/role/status/expiry/accepted membership; customer display name/code/email/
status/version; invoice state/number/customer, dates, Decimal-string totals,
discount/tax and safe item IDs/quantities/prices; payment receipt plus invoice
settlement; expense/category business evidence; and export report type/format.
Nested objects have explicit schemas. Changed-field paths use those same
allowlists. Only organization closure `metadata.reason` is exposed; other
metadata is null. Unknown entities/payload keys, export parameters, session IDs,
IP/user-agent, credential/hash/token/header/provider secrets, stack traces and
internal idempotency evidence are omitted. Unexpected nested values in scalar
fields and strings above 2,048 characters become null; item and changed-field
arrays are capped at 100. Safe stored scalar values, including Decimal strings,
are preserved without financial recalculation or numeric conversion. This does
not rewrite stored JSON or the immutable payment receipts used by replay.

The application rechecks membership/permission in a READ ONLY RepeatableRead
transaction and performs one tenant-fenced, filtered, ordered `limit + 1` Prisma
query using existing indexes. There is no total-count or actor/resource N+1 query,
write, audit-of-read, queue or cache. Existing append-only triggers remain intact;
no Prisma schema change, index addition or migration is required.

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
| GET | `/:orgId/audit-logs` | Audit | ✓ | ✓ | `audit.read` | — | read-only | — | Immutable, projected metadata |
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
