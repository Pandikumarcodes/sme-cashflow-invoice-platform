# Staging runtime verification

Verification date: 2026-10-16. Scope: configuration, local runtime behavior, and
safe checks only. No cloud resources, accounts, secrets, deployment, migration,
or non-test database were changed.

## 1. Executive Summary

**Verdict: READY WITH DOCUMENTED PREREQUISITES.** The code can proceed to
infrastructure provisioning with documented prerequisites.
The API and worker have independent compiled entry points, source-level graceful
shutdown, safe health behavior, and separate queue consumers. This review added
managed Redis URL support because the prior host/port-only configuration could not
use the `redis://` and `rediss://` URLs supplied by Render Key Value. Provider
connections, database migration rehearsal, backup restore, object storage round
trips, and real proxy/browser checks remain pending.

## 2. Current Git State

Branch: `main`; baseline HEAD: `7d38968485bf93b95c7314068be4b461b98eba41`.
The pre-existing uncommitted report-storage work remains present. This milestone
adds only Redis configuration/test/documentation changes and does not modify
Prisma schema, migrations, financial rules, tenant authorization, or HTTP routes.

## 3. Runtime Process Inventory

| Process  | Command after build             | Role                                 | Network                                                             |
| -------- | ------------------------------- | ------------------------------------ | ------------------------------------------------------------------- |
| API      | `npm.cmd run start:prod`        | Nest HTTP API                        | Listens on `PORT`; requires PostgreSQL/Redis for readiness          |
| Worker   | `npm.cmd run start:worker:prod` | BullMQ notification/report consumers | No HTTP listener; outbound PostgreSQL, Redis, S3-compatible storage |
| Frontend | `npm.cmd run build`             | Vite static artifact                 | Serve `frontend/dist/` from a static host                           |

Both backend start commands execute precompiled Babel JavaScript in `dist/`; they
do not rely on TypeScript development tooling. Development `start` and
`start:worker` build first. API `AppModule` does not import worker modules;
`WorkerModule` uses `createApplicationContext`, not `NestFactory.create`.

## 4. Verified Start Commands

`npm.cmd run build` compiled 225 backend files. Starting `node --env-file-if-exists=.env dist/main.js` independently registered the API and returned 200 from `/api/v1/health/live`. `/api/v1/health/ready` returned the existing safe 503 envelope while local PostgreSQL/Redis were unavailable. SIGINT invoked Nest shutdown hooks; queues, Redis and Prisma each expose module-destroy cleanup.

Starting `node --env-file-if-exists=.env dist/worker.js` initialized only worker modules and opened no HTTP server. It exited with the generic `Worker failed to start. Review infrastructure readiness.` when its startup PostgreSQL check could not connect. That is expected on this machine. `Worker.close()` waits for active jobs; queue factories close queues before Redis disconnects. A real in-flight-job termination test remains pending.

## 5. Environment Variable Matrix

`NODE_ENV=production` is the deployment mode for staging because it enables strict
HTTPS/origin, signing-key, S3 storage, and Redis URL validation. Values below are
names and requirements only; never place secrets in Vite variables.

| Variable group                                                             | Local development                       | Test                                         | Staging API / worker                                                        | Staging frontend                           | Future production                  |
| -------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `DATABASE_URL`                                                             | local PostgreSQL                        | guarded replacement from `DATABASE_URL_TEST` | separate managed staging DB URL                                             | —                                          | separate managed production DB URL |
| `DATABASE_URL_TEST`                                                        | local isolated `sme_cashflow_test` only | required                                     | —                                                                           | —                                          | —                                  |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB` | localhost defaults                      | local test Redis                             | legacy non-URL option only                                                  | —                                          | legacy non-URL option only         |
| `REDIS_URL`                                                                | optional                                | optional                                     | required; Render internal `redis://` or external/TLS `rediss://`            | —                                          | required                           |
| `QUEUE_PREFIX`, `WORKER_CONCURRENCY`, reminder/email settings              | local names/defaults                    | isolated test namespace                      | same values in API and worker; `EMAIL_PROVIDER=disabled`                    | —                                          | isolated production namespace      |
| `AUTH_ACCESS_*`, JWT settings, rate limits                                 | local fixtures                          | test fixtures                                | distinct secret signing pair and settings in both processes                 | —                                          | distinct production secrets        |
| `CORS_ORIGINS`, `TRUST_PROXY`, `PORT`, logging                             | localhost/defaults                      | test origin                                  | exact HTTPS frontend origin, actual proxy policy, platform port, safe level | —                                          | production values                  |
| `REPORT_STORAGE_*`, `REPORT_S3_*`                                          | local adapter permitted                 | fixture/temporary storage                    | S3 adapter and identical private settings in API/worker                     | —                                          | isolated bucket/prefix/credentials |
| `VITE_API_BASE_URL`                                                        | localhost `/api/v1`                     | test value                                   | —                                                                           | public HTTPS staging API URL at build time | public HTTPS production API URL    |

Production validation fails without `REDIS_URL`, private S3 configuration, explicit
HTTPS CORS origin, or replacement signing keys. URL errors identify field names,
never values. `REDIS_URL` accepts only `redis://`/`rediss://`, an optional numeric
database path, and no query/fragment; it is parsed to ioredis options without
logging the original URL.

## 6. Redis/BullMQ Compatibility

The new `REDIS_URL` handling parses host, port, database and URL-encoded
credentials. `rediss://` supplies ioredis `tls: {}`; `redis://` remains plain
TCP. BullMQ gets the same parsed options with `maxRetriesPerRequest: null`, which
supports its blocking connections, while direct health/rate-limit commands retain
short timeouts and fail-fast behavior. Queue retries use three attempts and
exponential backoff; worker concurrency is bounded by `WORKER_CONCURRENCY`.

Render documents compatible Valkey/Redis endpoints, private same-region internal
URLs, optional internal authentication, and `redis://`/`rediss://` schemes. [Render Key Value](https://render.com/docs/key-value) and [its ioredis guide](https://render.com/docs/connecting-to-redis-with-ioredis) support this configuration; ioredis documents the TLS URL behavior. [ioredis TLS](https://github.com/redis/ioredis#tls-options)

**PENDING LIVE VERIFICATION:** actual Render endpoint auth/TLS, command support,
connection limits, reconnection during a network interruption, BullMQ blocking
connections, queue lag, and graceful drain. Use one API/one worker initially,
same region/private network, a unique queue prefix, and a capacity plan accounting
for queue/worker Redis connections. Do not use the public endpoint when the private
URL is available.

## 7. PostgreSQL/Prisma Compatibility

Prisma uses `DATABASE_URL`; provider TLS/pool parameters belong in that URL and
must be verified against the selected managed PostgreSQL service. Release procedure
is `npm.cmd run db:generate`, then exactly one controlled `npm.cmd run db:migrate:deploy` with the staging URL before API/worker rollout. Never use `prisma migrate dev`, `db push`, reset, seed, or guarded clearing suites on staging.

Use a fresh isolated staging database. The invoice-document-evidence migration adds
issued/cancel/void evidence fields and a CHECK constraint; it is unsafe to apply to
populated legacy invoices unless historical rows are reviewed and satisfy the new
constraint. Migration credentials require DDL privileges; runtime credentials should
be least-privileged. Budget pooled connections across API replicas, worker,
migration runner and maintenance. App rollback does not roll back schema.

## 8. Authentication/Cookie/CORS/Proxy Findings

For `https://staging.example.com` and `https://api-staging.example.com`, the API
sets a host-only, Secure, HttpOnly, SameSite=Lax refresh cookie scoped to
`/api/v1/auth`; the frontend sends `credentials: 'include'`. Set the exact frontend
origin in `CORS_ORIGINS`; wildcard origins are rejected. These sibling HTTPS hosts
are same-site, unlike unrelated hostnames where Lax cookie behavior can break
refresh even if CORS passes. No cookie-domain override is needed.

Configure `TRUST_PROXY` only for the actual HTTPS-terminating proxy boundary and
test forwarded scheme/IP behavior, rate limits, refresh rotation, logout and session
invalidation. The current boolean setting cannot express a proxy-hop allowlist, so
this is **PENDING LIVE VERIFICATION** rather than a security assertion.

## 9. S3 Configuration and Lifecycle Requirements

The existing adapter preserves local development storage and requires S3 in
production mode. It validates bucket/region/prefix/credentials, permits only HTTPS
custom endpoints, uses private randomized organization-scoped keys, uploads before
READY, checks download length/checksum, and tenant-checks deletion. API and worker
construct independent clients from the same settings. `PutObject` is bounded to
10 MiB; multipart upload is not used.

Grant the API/worker identity only `s3:PutObject`, `s3:GetObject`, and
`s3:DeleteObject` on the dedicated bucket/prefix (plus only any provider-required
bucket metadata permission). Block public access, encrypt at rest, retain version/
access logs per provider policy, and never expose object URLs. Storage retries must
be proven against the selected compatible provider.

Lifecycle strategy: keep READY objects at least as long as database metadata can
be downloaded; expire database state before or atomically with any bucket lifecycle
rule. Reconcile objects with no durable `ReportExport` reference after a conservative
grace window. The worker deletes provisional failed artifacts in-source, but no
periodic orphan reconciler exists. Configure incomplete-multipart cleanup separately;
it is not a successful-upload orphan and is currently unused by this adapter.

## 10. Worker/API Independence

Source inspection and local starts confirm API route registration does not create
workers, and worker startup does not create HTTP routes. Both validate their own
configuration and share only durable PostgreSQL, Redis queue, and report object
store boundaries. Notification startup verifies database/queue readiness before
processors/schedulers register; report startup waits for its queue. This avoids
accepting worker work before dependencies are usable.

## 11. Frontend Static Hosting Requirements

`npm.cmd run build` produces `frontend/dist/`; it passed locally. Build with the
public `VITE_API_BASE_URL=https://api-staging.example.com/api/v1`. Never expose
backend credentials through `VITE_*`. A Render static site can serve the output,
but requires a catch-all SPA rewrite to `/index.html` for React Router while missing
assets retain 404s. Hash assets may cache long; HTML should have short/no cache.
Verify direct deep links, credentials, organization switching, lazy chunks and CSV
download after the real build is hosted.

## 12. Graceful Shutdown and Health Checks

Nest shutdown hooks are enabled in API and worker. Worker `close()` waits for active
jobs, QueueFactory closes queues, Redis quits/disconnects, and Prisma disconnects.
BullMQ recommends SIGTERM/SIGINT graceful closure. [BullMQ production guidance](https://docs.bullmq.io/guide/going-to-production)

`/api/v1/health/live` is process liveness. `/api/v1/health/ready` checks PostgreSQL
and Redis and returns 503 safely on failure; it does not prove worker or report-store
health. Use liveness for restart detection and readiness for traffic gating. Staging
must set a termination grace period exceeding observed longest in-flight job time;
that duration and queue drain remain **PENDING LIVE VERIFICATION**. Monitor startup
failure, readiness, request IDs, 5xx rate, Redis/queue errors, failed-job counts,
oldest pending event, report failures, and DB connection pressure. Pino serializers
and redaction exclude request bodies, credentials, cookies, authorization and
set-cookie headers; connection URLs must never be logged.

## 13. Test Execution Evidence

| Check                           | Result                               | Evidence                                                                                |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Backend lint/format/build       | PASS                                 | `npm.cmd run lint`, `format:check`, build (225 files)                                   |
| Backend unit/config/storage     | PASS                                 | `npm.cmd run test`: 49 suites, 315 tests; includes S3/local storage and Redis URL tests |
| API inventory                   | PASS                                 | `npm.cmd run verify:api-inventory`: 65 implemented/documented routes                    |
| API runtime                     | PASS                                 | built API started independently; live 200; unavailable dependencies gave safe ready 503 |
| Worker runtime                  | BLOCKED — INFRASTRUCTURE UNAVAILABLE | independent context startup reached dependency check then exited safely                 |
| Prisma status                   | BLOCKED — INFRASTRUCTURE UNAVAILABLE | guarded test target `localhost:5432` unreachable; no mutation performed                 |
| Integration/E2E/queue suites    | BLOCKED — INFRASTRUCTURE UNAVAILABLE | Docker CLI absent; PostgreSQL 5432 and Redis 6379 refused TCP connections               |
| Frontend type/lint/format/build | PASS                                 | `typecheck`, `lint`, `format:check`, and production build passed                        |
| Documentation formatting / diff | pending final document check         | run after this file update                                                              |

## 14. Backup/Restore Prerequisites

Planned procedure: select managed PostgreSQL backup retention and PITR consistent
with approved RPO/RTO; backup before risky migrations; restore only to an isolated
database; rehearse migration against restored data; verify invoice totals, tenant
composite FKs, checks, migration history and connection limits; record owner/time/
result. Locally verified procedure: none. **PENDING PROVIDER VERIFICATION:** backup
schedule, retention, PITR window, restore permissions/time, encryption and restore
network isolation.

## 15. Confirmed Blockers

- **BLOCKED — INFRASTRUCTURE UNAVAILABLE:** Docker CLI is absent.
- **BLOCKED — INFRASTRUCTURE UNAVAILABLE:** local PostgreSQL test port 5432 and Redis port 6379 are unreachable.
- **BLOCKED — INFRASTRUCTURE UNAVAILABLE:** database integration, HTTP E2E, queue tests and migration-status verification cannot safely run.

## 16. Pending Provider Verification

Render Key Value Redis/BullMQ behavior and capacity; managed PostgreSQL TLS/pooling,
migration/recovery rehearsal; S3-compatible permissions/private access/object round
trips/lifecycle; real HTTPS proxy/CORS/cookie behavior; in-flight worker termination;
static-host SPA rewrite and real-browser smoke checks. None was claimed successful.

## 17. Required Cloud Resources

One isolated staging PostgreSQL database, same-region Render Key Value instance,
private S3-compatible bucket/prefix and scoped identity, separately supervised API
web service and worker service, static frontend host, sibling HTTPS domains, secret
stores for distinct signing/database/Redis/S3 values, and monitored backup/restore
capability. No resource was created here.

## 18. Recommended Next Milestone

Provision the isolated staging infrastructure and perform the documented live
connectivity, migration-rehearsal, backup/restore, worker-drain, proxy/cookie and
report-storage verification.
