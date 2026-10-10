# Prompt 21 Reports / Export

ReportsModule owns ReportExport commands, metadata and download authorization.
FinancialModule exports ReportReader for the register joins and delegates cash,
performance and aging to the existing canonical readers. Shared invoiceFacts
keeps authoritative receipt cutoffs and settlement validation identical to Analytics.
Reports never mutate financial facts or acquire locks on source invoices/payments.

The eight public routes, parameter allowlists, response shapes and development
storage/expiry policy are specified in api-contracts.md. CSV columns are fixed in
src/modules/reports/domain/csv.js; untrusted text and trusted monetary strings
have separate serialization rules. Source reads use one read-only RepeatableRead
transaction and fail closed on currency/settlement inconsistencies.

Request commits ReportExport PENDING, audit and REPORT_EXPORT_REQUESTED PendingEvent
atomically. Optional shared idempotency claims reference the same export.
ReportWorkerModule uses canonical reports.generate with a dispatch tick every five
seconds, calling the same PendingEventDispatcher as notifications. Jobs contain
version, organizationId and eventId; the durable event contains version,
organizationId and exportId. Redis carries no report contents or financial truth.

Generation locks event then export consistently, validates event version/source
identity, rechecks current ACTIVE requester/membership/organization and report.export,
and records RUNNING with a 60-second claim. Private artifact I/O happens outside
database transactions. A fresh duplicate claim exits; stale claims may recover.
Completion checks claim ownership and atomically stores READY, checksum, BigInt
rowCount, completedAt/expiresAt, acknowledges the event, and appends one requester
REPORT_READY notification through Notifications' narrow transaction-scoped contract.
READY/FAILED/EXPIRED executions are terminal replays, never overwrite output.

The existing errorCode field stores REPORT_ATTEMPT_1..3 while pending/running;
these private attempt markers are never returned publicly. This supplies a durable
three-attempt generation budget without schema changes; dispatch attemptCount
remains infrastructure-only. A transient failure defers the event with exponential
delay and allows BullMQ retries. Invalid definitions, revoked access, financial
inconsistency and size limits are permanent failures; exhausted transient attempts
persist REPORT_ATTEMPTS_EXHAUSTED. Exceptions, paths and provider/ORM details are
never stored in public errors or forwarded to BullMQ. Database/broker outages leave
leases recoverable. Ambiguous completion commits are rechecked before discarding
an artifact; durable completed files are preserved.

Local files use unique opaque keys, exclusive creation, SHA-256 integrity checks
and restrictive creation modes where supported. The directory must have private
host ACLs on Windows and be shared between local API/worker processes. It is never
served statically. Download rechecks current tenant permission before reading and
again before auditing artifact release; filenames contain only server enum/UUID.
No cloud integration, signed external URLs, cleanup scheduler or production
storage deployment is implemented. Metadata and expired files remain retained for
a future approved retention policy. Failed/abandoned process attempts can leave
unreferenced private files; automatic orphan cleanup belongs to that policy.

Schema is unchanged by Prompt 21. Existing ReportExport statuses/columns and
PendingEvent/Notification uniqueness are sufficient. The earlier Prompt 20 FK
migration remains separate and has been applied to the guarded test database.

## Verification

Verified on 2026-10-10. PostgreSQL/E2E/queue suites ran sequentially against the
dedicated guarded sme_cashflow_test database; queues used real Redis and isolated
namespaces. The combined Nest worker startup/shutdown is included in queue coverage.

| Command | Outcome |
|---|---|
| npm.cmd run test | 44 suites / 290 tests passed |
| npm.cmd run test:integration | 14 suites / 128 tests passed |
| npm.cmd run test:e2e | 13 suites / 69 tests passed |
| npm.cmd run test:queues | 3 suites / 8 tests passed |
| npm.cmd run build | 213 JavaScript files compiled |
| npm.cmd run format | Passed |
| npm.cmd run format:check | Passed |
| npm.cmd run lint | Passed |
| node_modules\\.bin\\prisma.cmd validate | Passed; existing Prisma deprecation/composite SetNull warnings remain |
| git diff --check | Passed |

Report-focused units passed 3 suites/32 tests; the environment suite adds one
report configuration test (33 new units total). New PostgreSQL coverage has 11
cases, E2E has five, and queue coverage has three. Artifact checks include all six
types, precise amounts and current-state reconciliation, CSV quoting/UTF-8/formula
safety, limits, checksums, private keys, download authorization/audit and expiry.
The guarded migration-deploy check found no pending migrations.

## Prompt 21 file inventory

This inventory is relative to the task's starting working tree. Existing uncommitted
Prompt 19/20 files and migration changes are preserved.

Created:

- docs/reports-implementation.md
- src/worker.module.js
- src/modules/financial/infrastructure/report-reader.js
- src/modules/notifications/application/report-ready-notifier.js
- src/modules/reports/application/reports.service.js
- src/modules/reports/application/report-generation.service.js
- src/modules/reports/domain/report.js
- src/modules/reports/domain/report.spec.js
- src/modules/reports/domain/csv.js
- src/modules/reports/domain/csv.spec.js
- src/modules/reports/infrastructure/report-persistence.js
- src/modules/reports/infrastructure/report-storage.js
- src/modules/reports/processors/report-workers.js
- src/modules/reports/processors/report-workers.spec.js
- src/modules/reports/report-worker.module.js
- src/modules/reports/reports.controller.js
- src/modules/reports/reports.module.js
- test/helpers/report-fixture.js
- test/integration/reports.integration-spec.js
- test/integration/reports.queue-integration-spec.js
- test/reports.e2e-spec.js

Modified:

- .env.example
- .gitignore
- README.md
- docs/api-contracts.md
- docs/api-inventory.md
- docs/backend-architecture.md
- docs/database-design.md
- docs/domain-rules.md
- docs/implementation-roadmap.md
- docs/product-requirements.md
- src/app.module.js
- src/common/errors/error-codes.js
- src/common/errors/error-http-map.js
- src/common/idempotency/idempotency.service.js
- src/config/env.schema.js
- src/config/env.schema.spec.js
- src/modules/financial/financial.module.js
- src/modules/financial/infrastructure/analytics-reader.js
- src/modules/notifications/notifications.module.js
- src/worker.js
- test/integration/run-integration-tests.js
