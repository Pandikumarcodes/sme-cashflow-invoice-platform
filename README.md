# SME Cash Flow & Invoice Management System

Backend-first, multi-tenant cash-flow and invoice management platform. The JavaScript backend is a NestJS modular monolith. PostgreSQL/Prisma, Redis/BullMQ infrastructure, authentication, organizations, memberships, reusable RBAC, trusted tenant infrastructure, Customers, Invoices, and Payments/reversals are established. Later financial modules and business workers remain deferred.

## Prerequisites

- Node.js 24 LTS (Node.js 22 or newer is supported)
- npm 10 or newer
- Docker with Compose for local PostgreSQL and Redis

## Setup

```bash
npm install
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if desired. The checked-in defaults are safe for local development; production configuration is validated more strictly.

## Development

```bash
npm run start:dev
```

The API defaults to `http://localhost:3000/api/v1`. Foundation endpoints are:

- `GET /api/v1/health/live`
- `GET /api/v1/health/ready`

Authentication endpoints are:

- `POST /api/v1/auth/register` creates only a global User and returns no credentials.
- `POST /api/v1/auth/login` returns a short-lived access token and sets the refresh cookie.
- `POST /api/v1/auth/refresh` rotates the single-use refresh cookie.
- `POST /api/v1/auth/logout` revokes the current session using the access token or refresh cookie.
- `POST /api/v1/auth/logout-all` revokes every session for the authenticated User.
- `GET /api/v1/me` returns the authenticated safe User profile.

Organization endpoints require a current access token:

- `POST /api/v1/organizations` creates an organization, invoice sequence, default expense
  categories, ACTIVE OWNER membership for the caller, and audit record atomically.
- `GET /api/v1/organizations` lists only ACTIVE organizations reached through the caller's ACTIVE
  memberships.
- `GET /api/v1/organizations/:organizationId` returns an organization only through an ACTIVE
  membership.
- `PATCH /api/v1/organizations/:organizationId` updates allowlisted settings for Owner/Admin and
  requires the current version in `If-Match`.
- `POST /api/v1/organizations/:organizationId/close` is the Owner-only retained-history lifecycle
  action; there is no organization DELETE endpoint.

Membership endpoints require a current ACTIVE membership in the requested organization:

- `GET /api/v1/organizations/:organizationId/members` lists members for Owners and Admins only.
- `POST`/`GET`/`DELETE /api/v1/organizations/:organizationId/invitations[/:invitationId]`
  creates, lists, and revokes organization-scoped invitations.
- `POST /api/v1/invitations/accept` accepts an email-bound, single-use invitation. The database
  stores only its SHA-256 hash; the raw token is surfaced only by the protected development
  delivery response while email delivery is unavailable.
- `PATCH /api/v1/organizations/:organizationId/members/:membershipId`, the `suspend` and
  `reactivate` commands, and DELETE manage a retained membership lifecycle. Each mutation
  requires `If-Match` and writes an audit record.
- `POST /api/v1/organizations/:organizationId/transfer-ownership` is the only way to change
  the Owner role. Ordinary member commands cannot create, demote, suspend, or remove an Owner.

Membership rows are retained as `ACTIVE`, `SUSPENDED`, or `REMOVED`; reactivation reuses the
same row. An organization always retains exactly one active Owner.

## Authorization

RBAC is code-defined in `src/common/authorization`: canonical permissions map from the current
database-backed Membership role (`OWNER`, `ADMIN`, `ACCOUNTANT`, `MEMBER`, or `VIEWER`). Tenant
routes authenticate first, load an ACTIVE membership and ACTIVE organization, then evaluate all
permissions declared by endpoint metadata. A non-member or inactive membership receives concealed
`404`; an active member without permission receives `403`; missing/invalid credentials receive
`401`. Roles and permissions are not JWT claims, so role/status changes affect the next request
without a new access token. Owner-targeting and lifecycle validity remain service-level domain
rules. Authorization attaches the trusted `request.tenant` context; services re-resolve access
on their Prisma client and use explicit tenant query helpers. See
[`docs/backend-architecture.md`](docs/backend-architecture.md#18-implemented-tenant-isolation-convention-prompt-12).

Base currency uses an ISO 4217 code and can change only before `currencyLockedAt` is set by first
invoice creation (or future expense creation). Timezones must be valid IANA zones. Registration continues to create only
a global User; it never creates an organization implicitly.

Every response includes `X-Request-Id`. A valid incoming UUID/ULID-style request ID is propagated; otherwise the server generates a UUID.

## Verification

```bash
npm run format:check
npm run lint
npm run test
npm run test:e2e
npm run test:integration
npm run test:queues
npm run build
```

Use `npm run format` to apply formatting and `npm run test:watch` for local unit-test iteration.

Auth unit tests run with `npm run test`; real PostgreSQL auth persistence/rotation tests run with `npm run test:integration`; HTTP and cookie flows run with `npm run test:e2e`. Integration and E2E auth tests are guarded to the local `sme_cashflow_test` database.

Organization domain tests run with `npm run test`; transaction/constraint tests run with
`npm run test:integration`; membership isolation and HTTP validation tests run with
`npm run test:e2e`.

The membership-focused tests are colocated under `src/modules/memberships/domain`,
`test/integration/memberships.integration-spec.js`, and `test/memberships.e2e-spec.js`.

## Configuration

Configuration is validated at startup with Zod. Application code consumes validated Nest configuration rather than reading environment variables throughout the codebase. See [.env.example](.env.example) for the active database, Redis, queue, and application settings. `REDIS_HOST` and `REDIS_PORT` default to `localhost:6379`; username/password are optional and local development requires neither.

Authentication additionally requires an Ed25519 PKCS#8 private key and matching SPKI public key, both provided as base64 DER values. `.env.example` contains a known local-only pair; production must supply securely managed unique keys. Access lifetime defaults to 900 seconds and the absolute refresh-session lifetime to 30 days. JWT issuer, audience, key ID, refresh-cookie name, and Redis rate limits are configurable with the `AUTH_*` settings.

Passwords use Argon2id. Access tokens contain only `sub`, `sid`, `jti`, `iss`, `aud`, `iat`, and `exp`. Opaque 256-bit refresh tokens are delivered in an HttpOnly, SameSite=Lax cookie; PostgreSQL stores only deterministic SHA-256 lookup hashes. Every successful refresh marks the old row used and creates one replacement in a serializable transaction. Reusing a used token compromises the whole session family and revokes its active token. Logout revokes PostgreSQL session state immediately, so an otherwise unexpired access token stops working.

## PostgreSQL and Prisma

Start local PostgreSQL and Redis with `npm run infra:up` (or `docker compose up -d postgres redis`). The local development database is `sme_cashflow`; `sme_cashflow_test` is a separate, dedicated integration-test database. Set their connection strings in your ignored `.env` using the placeholders in `.env.example`.

Run `npm run db:generate` after schema changes. Use `npm run db:migrate:dev` to create a reviewed development migration and `npm run db:migrate:deploy` to apply committed migrations. Inspect generated SQL before it is applied; do not use `prisma db push` for normal schema evolution. The initial migration includes PostgreSQL-only financial checks, partial unique indexes, composite tenant foreign keys, and audit append-only protection.

Run `npm run test:integration` only with local PostgreSQL available. Its runner requires `DATABASE_URL_TEST` to be localhost and point exactly to `sme_cashflow_test`; it does not fall back to the development database. The dedicated database is recreated from migrations during local clean-schema verification, never by a production-oriented package script.

`/health/live` reports process liveness without an infrastructure dependency. `/health/ready` probes PostgreSQL and Redis and returns a safe 503 response when either is unavailable.

`npm run start:dev` watches JavaScript source and restarts the built application. `npm run build` transpiles only legacy Nest decorator syntax to runnable JavaScript in `dist/`; it does not run TypeScript compilation.

Tests set `NODE_ENV=test` explicitly. Database integration tests use Prisma Decimal values and assert raw PostgreSQL constraints without converting authoritative values to JavaScript numbers.

## Redis and BullMQ

Redis is currently used only for BullMQ connectivity and readiness; there is no application caching, distributed locking, or Redis-backed idempotency. The Compose service enables append-only persistence and a named volume so local queued work survives ordinary container restarts. PostgreSQL remains authoritative.

Queue names and conservative default job options are centralized under `src/infrastructure/queues`. BullMQ creates the connections required by each future Queue, Worker, or QueueEvents instance rather than sharing the readiness client. No business queues, processors, or worker process are registered yet.

Run `npm run test:queues` with local Redis available to exercise a uniquely prefixed infrastructure-only queue, enqueue and consume one trivial job, clean its keys, and verify connection shutdown. Future tenant jobs carry IDs and correlation metadata, validate payloads, and reload authoritative tenant-scoped state from PostgreSQL; they never carry authoritative financial snapshots or mutate financial truth independently.

## Customers

Prompt 13 adds five tenant-protected routes under
`/api/v1/organizations/:organizationId/customers`: POST/GET collection,
GET/PATCH `/:customerId`, and POST `/:customerId/archive`. Create accepts
`displayName` and optional nullable `customerCode`/`email`; PATCH uses the
same fields and requires `If-Match`. Server fields and unknown input are rejected.

Lists default to ACTIVE customers, `displayName asc`, and 25 rows. They support
`status`, `search`, `sortBy`, `sortOrder`, `limit` (1–100), and opaque `after`
cursors. Detail GET includes archived customers. Archive accepts `{}`, is
idempotent, retains the row/code, and does not expose a restore/delete route.
Every mutation and its mandatory audit use one transaction. Current PostgreSQL
membership and the existing trusted tenant helpers govern every operation.

The wider conceptual Customer fields are not in the current Prisma schema and
are not accepted by this API. No Customer schema migration is introduced. Expenses and
later financial modules remain unimplemented.

Customer cursor tests run with `npm run test`; PostgreSQL isolation, concurrency,
and audit rollback tests with `npm run test:integration`; HTTP validation and
RBAC/customer lifecycle tests with `npm run test:e2e`.

## Invoices

Prompt 14 adds eight tenant-protected routes under
`/api/v1/organizations/:organizationId/invoices`: POST/GET collection,
GET/PATCH/DELETE `/:invoiceId`, and POST `/:invoiceId/issue`, `cancel`, `void`.
Prompt 14 brought the count to 36; Prompt 15 brings it to **40 implemented HTTP APIs**.

Create requires `customerId`, `issueDate`, `dueDate`, `discount:{type,value}`,
`taxRate`, and 1–1,000 `items:[{description,quantity,unitPrice,sortOrder}]`.
PATCH accepts a nonempty subset; supplied items replace the whole list atomically.
Dates are real YYYY-MM-DD dates with due >= issue. Decimal inputs are strings;
unknown/protected/nested fields are rejected. Optional notes, terms, purchase-order
reference, and wider Customer fields are deferred because they are absent from the
current schema. First draft creation permanently locks organization currency.

Server calculations use a private high-precision Decimal constructor and half-away-from-zero
rounding at the currency registry scale: round each line, sum, discount, then tax.
Amounts remain Prisma Decimal in PostgreSQL and strings at the API boundary.
The first financial mutation, draft edits, issue, delete, cancel and void each
commit their required audit within the application transaction.

Only DRAFT is editable/deletable. PATCH, DELETE and issue require `If-Match`.
Issue locks the tenant invoice and PostgreSQL sequence, recomputes, requires a
positive total and ACTIVE same-tenant Customer, freezes name/email and numbering
prefix, assigns prefix plus zero-padded counter, increments version, and commits
audit plus an ID-only versioned PendingEvent. No business queue/worker is started.
Cancel requires zero payment rows ever; void requires zero RECORDED payments.
Both require a reason and retain document/number/history. Payment state and overdue
are derived; overdue uses the organization's timezone, and due today is not overdue.
Recommended invoice idempotency keys/replay remain deferred; retries use documented
version/lifecycle conflicts and never allocate twice for the same invoice.

Lists support the documented filters and sorts, default to issueDate desc,
and use tenant/filter/sort-bound cursors with null invoice numbers last.

The reviewed `20261005000000_invoice_document_evidence` migration adds only
documented name/email snapshot, issuer and cancel/void evidence fields plus
CHECK/FK protection. It preserves existing composite FKs, financial CHECKs and
partial unique indexes. It intentionally refuses finalized legacy rows without
historical evidence rather than fabricating a backfill. Apply reviewed migrations
to development with `npm run db:migrate:deploy`; for the guarded dedicated test
database use `node --env-file=.env scripts/migrate-test-database.js`.
Only the test database was migrated by this milestone.

Invoice tests are colocated under `src/modules/invoices`,
`test/integration/invoices.integration-spec.js`, and `test/invoices.e2e-spec.js`.

## Payments and payment reversals

Prompt 15 implements four tenant-protected APIs:

- POST `/api/v1/organizations/:organizationId/invoices/:invoiceId/payments`
- GET `/api/v1/organizations/:organizationId/payments`
- GET `/api/v1/organizations/:organizationId/payments/:paymentId`
- POST `/api/v1/organizations/:organizationId/payments/:paymentId/reverse`

Record accepts `{amount,paymentDate,method}`; reverse accepts
`{reason,reversalDate}`. Both require a 16–128 character non-whitespace
printable ASCII Idempotency-Key. Amounts are positive decimal strings respecting
currency minor units; dates are real YYYY-MM-DD business dates. Optional
reference/notes/reference search are deferred because the schema lacks them.
Unknown input, currency, actors, totals and statuses cannot be assigned by clients.

OWNER, ADMIN and ACCOUNTANT have canonical payment permissions; MEMBER and VIEWER
do not. Every request rechecks current PostgreSQL membership. All resource access
is scoped to trusted Organization context; foreign/missing resources return 404.

Payments accept only ISSUED invoices. Application services own one transaction
for the idempotency claim, Invoice lock, RECORDED payment sum, mutation, paid/balance
cache and version update, audit, PendingEvent and claim completion. Invoice remains
ISSUED; UNPAID/PARTIALLY_PAID/PAID is derived. Reverse locks Invoice then Payment,
retains the original row and appends one immutable full-amount PaymentReversal.
There is no edit/delete/refund API. Cancel/void share the Invoice lock.
Overpayment is 422 PAYMENT_EXCEEDS_BALANCE with remaining balance; concurrent
losers observe the committed balance. Cache drift fails closed with 409
INVOICE_SETTLEMENT_INCONSISTENT; no reconciliation engine is added.

Keys are scoped to organization/User/operation, with normalized financial intent
hashing. Same intent replays original status/body plus Idempotency-Replayed: true,
even after later settlement, reversal or void; different intent is 409
IDEMPOTENCY_CONFLICT. Claims store resource references/status. Immutable audit
financial receipts reconstruct the original response without an idempotency
response blob. Retention is at least 30 days; automatic cleanup is not implemented.
A rollback leaves no claim or financial/audit/event mutation.

PAYMENT_RECORDED/PAYMENT_REVERSED audit and ID-only versioned PendingEvents commit
atomically. No business queue or schema migration is introduced.
Tests: colocated unit tests, `test/integration/payments.integration-spec.js`
and `test/payments.e2e-spec.js`; run the existing unit/integration/E2E commands.

## Architecture

The authoritative planning documents are in [`docs/`](docs/). Repository-specific implementation rules are summarized in [`AGENTS.md`](AGENTS.md).

Current exclusions are intentional: Expenses, reporting, business workers,
Swagger, and the frontend have not started.
