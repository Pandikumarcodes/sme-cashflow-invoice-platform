# Staging infrastructure runbook

Status: **DOCUMENTED; PENDING CLOUD PROVISIONING.** This is a review artifact.
It neither creates resources nor authorizes a Blueprint sync, deployment, migration,
or secret entry.

## Architecture and Blueprint

The proposed [Render Blueprint](../render.yaml) has one static React site, one
public NestJS API web service, one non-public BullMQ worker, private Render
Postgres, and private Render Key Value. The report bucket is deliberately outside
the Blueprint because this repository only supplies an S3-compatible client, not a
provider-specific bucket implementation.

| Resource        | Proposed name           | Plan/configuration                                    | Status                     |
| --------------- | ----------------------- | ----------------------------------------------------- | -------------------------- |
| Static frontend | `sme-staging-frontend`  | Render static site, `frontend/dist`                   | DOCUMENTED                 |
| API             | `sme-staging-api`       | Node `0.5c-512mb`, one instance                       | DOCUMENTED                 |
| Worker          | `sme-staging-worker`    | Node worker `0.5c-512mb`, one instance                | DOCUMENTED                 |
| PostgreSQL      | `sme-staging-postgres`  | PostgreSQL 16, `0.5c-1g`, 15 GB, private-only         | DOCUMENTED                 |
| Key Value       | `sme-staging-key-value` | `256mb`, `noeviction`, journal/snapshot, private-only | DOCUMENTED                 |
| Report storage  | provider-selected       | private S3-compatible bucket/prefix                   | PENDING CLOUD PROVISIONING |

`autoDeployTrigger: off` is set on deployable services. No custom domains are
hard-coded. `oregon` is a review placeholder: choose one supported region for all
private resources before the first sync. The Blueprint uses Render’s documented
native `rootDir`, build/start commands, internal datastore references, static rewrite
rules, and Key Value private allow-list. [Blueprint reference](https://render.com/docs/blueprint-spec)

## Build and process commands

| Component | Root       | Build                                                          | Start/public endpoint                            |
| --------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------ |
| API       | `backend`  | `npm ci --include=dev && npm run db:generate && npm run build` | `npm run start:prod`; `/api/v1/health/ready`     |
| Worker    | `backend`  | same API build                                                 | `npm run start:worker:prod`; no inbound endpoint |
| Frontend  | `frontend` | `npm ci --include=dev && npm run build`                        | Render serves `dist/`                            |

`--include=dev` is intentional: Babel, Prisma CLI, and Vite are development
dependencies required during build. The production starts run compiled JavaScript;
there is no Dockerfile requirement. Do not add a `preDeployCommand`: migrations run
exactly once in an approved controlled step, not with every replica deployment.

## Environment and secret matrix

| Variable group                                                 | API | Worker                  | Frontend        | Secret                         | Source                                         |
| -------------------------------------------------------------- | --- | ----------------------- | --------------- | ------------------------------ | ---------------------------------------------- |
| `NODE_ENV=production`, `LOG_LEVEL`, `TRUST_PROXY`              | yes | yes                     | —               | no                             | Blueprint; verify proxy behavior live          |
| `DATABASE_URL`                                                 | yes | yes                     | —               | yes                            | private Postgres `connectionString` reference  |
| `REDIS_URL`                                                    | yes | yes                     | —               | possibly                       | private Key Value `connectionString` reference |
| `QUEUE_PREFIX`, `WORKER_CONCURRENCY`, reminder/email variables | yes | yes                     | —               | no                             | identical runtime settings; email disabled     |
| `AUTH_ACCESS_*` signing pair                                   | yes | yes                     | —               | yes                            | manually generated matching staging pair       |
| JWT/cookie/rate-limit names                                    | yes | yes                     | —               | no                             | distinct staging values                        |
| `CORS_ORIGINS`                                                 | yes | validated by worker too | —               | no                             | manual exact HTTPS frontend origin             |
| `REPORT_STORAGE_*`, `REPORT_S3_*`                              | yes | yes                     | —               | credentials/bucket sensitivity | identical private object-store settings        |
| `VITE_API_BASE_URL`                                            | —   | —                       | yes, build time | no, public                     | full HTTPS API URL ending `/api/v1`            |

The Blueprint uses `sync: false` for values that cannot be safely invented:
signing keys, bucket credentials/details, CORS origin, and frontend API URL. If the
object provider requires a custom endpoint, add identical HTTPS-only
`REPORT_S3_ENDPOINT` values manually to API and worker; omit it for AWS S3. Never
put backend variables in `VITE_*`. Render documents `sync: false` as a dashboard
secret prompt on initial Blueprint creation. [Environment variables](https://render.com/docs/configure-environment-variables)

## Object storage plan

Use a private bucket with public access blocked, provider encryption at rest,
HTTPS-only access, access logs, and a dedicated `staging/reports` prefix. The code
uses only `PutObject`, `GetObject`, and `DeleteObject`; it does not require list,
bucket-wide delete, public URLs, or multipart uploads. Scope separate API and worker
identities to that prefix and those operations. Rotate credentials through the
provider secret store and update both services together.

Keep complete READY objects until database lifecycle allows expiry. Configure a
separate incomplete-multipart-abort rule even though current 10 MiB single-object
uploads do not create multipart uploads. Reconcile completed objects without a
durable `ReportExport` reference only after a recovery grace period; they are not
the same as incomplete multipart uploads. Alert on upload/read/delete failures,
checksum mismatch, provider access denial, and orphan reconciliation results.

Future synthetic round trip: request report; observe durable pending event; confirm
worker uploads private object; download through API using a different process;
attempt foreign-tenant access (404); expire report; verify deletion is tenant scoped;
restart API/worker and repeat. Do not use real customer data.

## PostgreSQL and Key Value preparation

Provision a fresh PostgreSQL 16 database only. No production data import. Keep
public database access disabled, use private networking, allocate connection headroom
for API, worker, migration session and maintenance, and start without pgBouncer;
enable/rehearse pooling only if measured connection demand requires it. Use a
restricted migration identity for `prisma migrate deploy` and a distinct least-
privilege runtime identity if the provider supports it. Confirm TLS behavior from
the supplied private connection URL.

Before the one controlled migration: confirm target identity, backup/PITR policy,
and committed migration SQL. Afterward verify financial Decimal precision, composite
tenant foreign keys, active-owner/invoice-number/idempotency constraints, invoice
lifecycle checks, required indexes, and the audit append-only trigger. The invoice
evidence migration is suitable for the planned empty database; never use it to
invent legacy invoice evidence.

Key Value uses the provider private `redis://` URL, persistent journal/snapshot
mode, `noeviction`, unique `sme:staging` prefix, and one worker initially. Redis
is queue/rate-limit infrastructure, never financial truth. Confirm worker operation
while API remains healthy, retry/backoff, reconnect, job retention, queue growth,
and SIGTERM drain. Render recognizes background workers as long-running queue
consumers and supports BullMQ’s use case. [Render workers](https://render.com/docs/background-workers)

## Network, HTTPS, and browser prerequisites

The API may use its temporary Render hostname for unauthenticated health checks.
Safe browser refresh-cookie authentication needs sibling HTTPS custom domains such
as `staging.example.com` and `api-staging.example.com`: host-only SameSite=Lax
cookies then remain same-site. Do not weaken cookie policy or set `SameSite=None`
just to use unrelated generated domains. Set the exact frontend origin in
`CORS_ORIGINS`, use `VITE_API_BASE_URL` with `/api/v1`, and validate `TRUST_PROXY`
against actual forwarded IP/proto headers.

The static service has `/* -> /index.html`; Render serves existing assets before
the rewrite, so missing assets retain real 404s. Verify direct navigation/refresh
of authenticated organization routes, static asset caching, CSV download, logout,
and workspace switching. [Static rewrites](https://render.com/docs/redirects-rewrites)

## Rollout and human approval gates

1. **Human approval:** review Blueprint, region, exact plans, expected costs, provider terms, and custom-domain decision.
2. **Human approval:** commit the reviewed configuration through normal Git review; create isolated staging resources and enter secrets.
3. **Human approval:** verify private Postgres/Key Value connectivity and bucket permissions; take/verify pre-migration recovery capability.
4. **Human approval:** run migration preflight and one `prisma migrate deploy` against the empty staging database.
5. Deploy API; gate traffic on live/ready health, safe logs and proxy behavior.
6. Deploy worker; gate progression on queue registration, synthetic job completion and safe shutdown.
7. Deploy frontend; configure domains/CORS; verify browser session behavior, reports, financial workflows and tenant isolation.
8. **Human approval:** verify backup restore and record staging acceptance.

Protect a future staging deployment workflow with a dedicated GitHub Environment,
required reviewers, isolated staging secrets, explicit production environment, and
manual release approval. Existing verification CI remains unchanged.

## Cost estimate

Approximate low-traffic recurring baseline: **US$30–45/month plus object-storage
usage and bandwidth**. Assumptions: two small always-on compute services, paid
Postgres, paid persistent Key Value, free static site, and modest private object
storage. Render’s published example of equivalent small web/worker/Postgres/Key
Value components totals about US$30/month, while plan, workspace, bandwidth, backup
window and region pricing must be reconfirmed before approval. [Render pricing](https://render.com/pricing)

## Status

VERIFIED: repository scripts, local compiled process behavior, configuration
validation, frontend/backend builds, report adapter tests. DOCUMENTED: Blueprint,
runbooks, rollback/recovery/checklists. PENDING CLOUD PROVISIONING: all proposed
services, domains, secrets, bucket, database and Key Value. PENDING LIVE
VERIFICATION: every network, migration, browser, storage and recovery round trip.
