# Final backend readiness — Prompt 23

Verification date: 2026-10-11. Runtime: Node.js 24.18.0. This is the final core backend hardening pass. **READY FOR FRONTEND INTEGRATION.** All required final checks pass; no unresolved core backend blocker remains.

## Readiness audit

Repository layout update: backend commands below run from `backend/`; listed
code/test/script paths are backend-relative. Docs and Compose remain at root.
Prompt 23 outcomes are historical baseline results; structural checks are recorded
in [repository restructure](repository-restructure.md).

The working tree was clean before this task. Review covered the authoritative planning documents, source modules, migrations, tests, and registered routes. Only confirmed defects and material risks were changed.

| Area                  | Severity  | Finding and disposition                                                                                                                                                                                                                                                            |
| --------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture          | NO ACTION | JavaScript Nest modular monolith; application-owned transactions; narrow module boundaries preserved.                                                                                                                                                                              |
| Security              | HIGH      | Invalid/mismatched signing keys failed late; published development keys were accepted in production. Startup now validates a matching Ed25519 pair and rejects the published production key. Cookie origin and JSON transport protections were incomplete; enforced and tested.    |
| Tenant isolation      | NO ACTION | HTTP and worker resource reads use trusted tenant scope. Composite tenant relationships and concealed cross-tenant 404s remain intact.                                                                                                                                             |
| Financial correctness | NO ACTION | Prisma Decimal remains authoritative; no Number money defect was found. Reports reuse financial readers.                                                                                                                                                                           |
| Database integrity    | MEDIUM    | Concurrent Prisma initialization created separate clients. One initialization promise now owns a single client and shutdown awaits it.                                                                                                                                             |
| Concurrency           | NO ACTION | Invoice sequences, settlements, reversals, expense/category transitions and membership ownership use locks, conditional writes or constraints.                                                                                                                                     |
| Idempotency           | MEDIUM    | Repeated signed bearer logout failed after revocation, and an expired bearer blocked valid cookie logout. Logout now verifies identity for revocation without requiring an active session, and safely falls back to its cookie. Financial command claims remain scoped and atomic. |
| Queues/workers        | NO ACTION | PendingEvent commits precede dispatch. Workers validate IDs and reload tenant state, use bounded durable attempts and handle completed replays.                                                                                                                                    |
| Configuration         | HIGH      | Validation errors could echo invalid values. Errors now contain field names only. Production requires explicit HTTPS origins.                                                                                                                                                      |
| Observability         | HIGH      | Unexpected exceptions logged messages/stacks; default HTTP serializers included raw URLs and headers. Safe event fields and allowlisted serializers prevent this disclosure. Completion logs include route templates.                                                              |
| API consistency       | NO ACTION | Registered metadata and inventory agree on 65 routes. Auth media-type and origin behavior is documented.                                                                                                                                                                           |
| Testing               | LOW       | Added focused regression coverage for the confirmed defects and persistent API inventory verification.                                                                                                                                                                             |
| Documentation         | LOW       | Corrected TypeScript wording, runtime minimum and milestone status. Added prebuilt worker and guarded migration-status commands.                                                                                                                                                   |
| Production risks      | MEDIUM    | Oversized report artifacts were allocated before size checks. Reads now inspect one opened file, allocate at most 10 MiB + 1 byte and reject growth/truncation/checksum mismatch. Operational rollout prerequisites remain explicit below.                                         |

No BLOCKER was found during review. No new product route, module, schema migration or dependency upgrade was introduced.

## Security and request behavior

Access tokens remain minimal signed identity/session credentials. Authentication rechecks current ACTIVE User and session for resource access; logout's narrow revocation path grants no resource access. Refresh hashes remain authoritative in PostgreSQL and rotation/reuse detection is preserved. Authorization uses current Membership and canonical permission constants without JWT roles or permission caches.

All authentication POSTs require Content-Type: application/json; empty commands send {}. Other media types return 415 INVALID_REQUEST. Login rejects supplied unapproved Origin/Referer. Production cookie refresh/logout requires an allowed Origin, or an allowed Referer origin when Origin is absent. An invalid supplied Origin never falls back. Native bearer-only logout can omit browser headers. Development/test retain headerless cookie requests for local nonbrowser clients.

Production requires explicit HTTPS CORS origins and unique matching Ed25519 signing keys. Published local keys remain intentional development/test fixtures and are rejected in production. Errors never echo invalid environment values or key bytes.

HTTP request logs omit raw URLs, headers, bodies and raw exception messages/stacks. Request IDs, methods, safe route templates, response status and duration remain available. Application error responses retain the canonical safe envelope.

Report downloads still authorize current membership, permission and requester ownership, check expiry and tenant-prefixed opaque keys, and verify private artifact checksums. CSV formula protection is unchanged. Workers do not trust financial snapshots from Redis.

## Financial and database integrity

RECORDED Payments contribute to inflow/revenue; REVERSED Payments are excluded, without subtracting reversal rows again. ACTIVE Expenses contribute to outflow/expenses; VOIDED Expenses are excluded. Cash Flow net and cash-basis P&L net use the same source semantics. Analytics and reports derive balances from authoritative recorded payments rather than stale settlement caches. Issued invoice immutability, Decimal rounding/string serialization, transaction-scoped audit/event writes and tenant foreign keys remain intact.

Three migrations exist and both configured local development and guarded sme_cashflow_test databases are current. No schema change was needed. Prisma validation passes.

The existing Prisma warning for the optional tenant-composite Notification relation is accepted: PostgreSQL uses ON DELETE SET NULL ("notificationId"), retaining required organizationId. The actual constraint was inspected. The package.json Prisma configuration deprecation is retained for the existing Prisma 6 baseline; no Prisma major upgrade or TypeScript configuration was added.

## Async and lifecycle behavior

Redis and BullMQ remain delivery infrastructure. PendingEvent remains a durable transactional handoff; PostgreSQL statuses and attempt ledgers determine processing truth. Notification/reminder and report processors remain in their owning modules and run only in the worker composition. Retries, duplicate dispatch and terminal replays are covered by real database/Redis tests.

Liveness does not require database/Redis availability. Readiness checks required dependencies and exposes a safe error on failure. API initialization/close is exercised by E2E suites; the combined worker initialization and graceful close is covered by the queue suite, including open-handle detection. Prisma now shares concurrent first use and awaits initialization before disconnect.

Use npm run start:prod and npm run start:worker:prod for prebuilt output with environment injected externally. The development worker command still builds and loads the local ignored .env file.

## Verification

| Command                        | Result                                                    |
| ------------------------------ | --------------------------------------------------------- |
| npm run test                   | Passed: 48 suites / 308 tests                             |
| npm run test:integration       | Passed: 15 suites / 134 tests                             |
| npm run test:e2e               | Passed: 14 suites / 77 tests                              |
| npm run test:queues            | Passed: 3 suites / 8 tests; open-handle detection enabled |
| npm run format                 | Passed                                                    |
| npm run format:check           | Passed                                                    |
| npm run lint                   | Passed                                                    |
| npm run build                  | Passed: 223 JavaScript files                              |
| npm run verify:api-inventory   | Passed: 65 implemented and documented routes              |
| npx prisma validate            | Passed, documented warnings retained                      |
| npx prisma migrate status      | Passed: 3 migrations, development database current        |
| npm run db:migrate:status:test | Passed: 3 migrations, guarded test database current       |
| git diff --check               | Passed                                                    |

The first full E2E attempt failed with five auth test/hook timeouts during a prolonged host slowdown (one formatter step took over 13 minutes). A read-only database activity check found no blocked transaction at that point. The complete unchanged-timeout E2E rerun passed all 14 suites/77 tests; no failure remains unresolved. Test timeouts and financial transaction limits were not increased.

An additional compiled API smoke check used node --env-file=.env --input-type=module with a stdin helper, ephemeral in-memory Ed25519 keys and the guarded test database. NestFactory startup, actual HTTP liveness/readiness and graceful app.close all passed. No secrets or private .env changes were persisted. Worker startup/close was verified by the combined Nest worker queue test.

Database integration, E2E and queue runs are sequential because they share the guarded test database. No test runner falls back to a development database. Build output, report files and coverage remain ignored. Review changes are left uncommitted.

## Frontend readiness contract

The maintained API contracts and 65-route inventory cover authentication/current user, organizations, memberships/invitations and RBAC, Customers, Invoices, Payments/reversals, Categories/Expenses, Cash Flow, cash-basis P&L, analytics, notifications, asynchronous CSV exports and read-only audit history.

- Use Authorization: Bearer <accessToken> for authenticated resource calls. Refresh credentials use the HttpOnly cookie with credentials included; do not store or inspect the refresh token in frontend code.
- Send JSON for authentication POSTs, including {} for refresh/logout commands. Browser deployments must use approved HTTPS origins and the existing same-site Lax cookie policy.
- Organization path IDs request scope; current active membership establishes authority. Nonmembership/cross-tenant resources return concealed 404; an active member lacking permission receives 403.
- Send the documented quoted version in If-Match for versioned changes; retain returned ETag values. Apply this only to routes requiring it.
- Send Idempotency-Key on payment recording/reversal and export creation where required; replay retains the original canonical receipt. Conflicting reuse returns the documented conflict.
- Use each list's documented limit/cursor/filter contract. Cursors bind scope/filters; intentionally unpaginated organization/membership/category arrays remain documented.
- Keep money, quantities and rates as Decimal strings; do not send JSON numeric money or compute authoritative totals in the frontend.
- Business dates use YYYY-MM-DD and organization timezone semantics. Audit timestamps are UTC instants with documented organization-local date filtering.
- Handle the canonical error envelope {error:{code,message,requestId,...safeDetails}} and route-specific status codes.
- Reports return 202 export metadata, then status polling and authorized private CSV download. Preview/read and export permissions are distinct; artifact expiry is enforced.
- Read-only audit history includes safe allowlisted metadata and nullable historical references.

## Deferred operational and product work

Production deployment must supply private keys, HTTPS/reverse-proxy configuration, protected database/Redis credentials, private shared API/worker report storage, database grants/backups and a retention policy. These are deployment responsibilities; this prompt does not deploy the application.

External email is intentionally disabled unless a later real provider is integrated; capture is development/test only. Cloud object storage, artifact cleanup scheduling, frontend, deployment automation, AI, historical-as-of reconstruction and advanced accrual accounting remain intentionally deferred. They are not substitutes for unresolved core defects.

## Changes

Modified:

- .env.example; README.md; package.json; package-lock.json
- docs/api-contracts.md; docs/api-inventory.md; docs/implementation-roadmap.md; docs/product-requirements.md
- scripts/migrate-test-database.js
- src/bootstrap.js; src/common/filters/global-exception.filter.js
- src/config/env.schema.js; src/config/env.schema.spec.js
- src/database/prisma.service.js
- src/modules/auth/application/auth.service.js; src/modules/auth/controllers/auth.controller.js
- src/modules/auth/tokens/access-token.service.js; src/modules/auth/tokens/access-token.service.spec.js
- src/modules/reports/infrastructure/report-storage.js
- src/observability/observability.module.js; src/observability/redaction.js; src/observability/redaction.spec.js
- test/auth.e2e-spec.js

Created:

- docs/production-readiness.md
- scripts/check-api-inventory.js
- src/common/filters/global-exception.filter.spec.js
- src/database/prisma.service.spec.js
- src/modules/reports/infrastructure/report-storage.spec.js

The runtime minimum is Node.js 22.9.0 because scripts use [--env-file-if-exists](https://nodejs.org/api/cli.html#--env-file-if-existsfile). Node.js 24.18.0 was used for verification. No architectural deviation, generic framework, frontend, deployment implementation, AI, advanced accounting or new product module was introduced.
