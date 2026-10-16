# Staging release candidate

Status: **READY FOR GIT REVIEW**. This is not a commit, hosted-CI result, cloud
provisioning approval, or staging-acceptance claim.

## 1. Baseline commit

Baseline branch/commit: `main` at `7d38968485bf93b95c7314068be4b461b98eba41`.
No branch history has been rewritten, and no commit, push, merge, migration,
deployment, or remote-infrastructure action occurred during preparation.

## 2. Current source inventory

The candidate consists only of deployment preparation work:

| Group                          | Files and purpose                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Shared report storage       | S3-compatible adapter, local adapter changes, S3/unit coverage, independent API/worker integration coverage, SDK dependency, environment example/README |
| B. Managed Redis compatibility | `REDIS_URL` validation/configuration/parser and tests for `redis://`/`rediss://`                                                                        |
| C. Runtime verification        | staging runtime verification and readiness updates                                                                                                      |
| D. Infrastructure Blueprint    | root `render.yaml`                                                                                                                                      |
| E. Operational runbooks        | infrastructure, release, backup/restore, rollback and report-storage documentation                                                                      |
| F. Unrelated changes           | none identified                                                                                                                                         |

There are no pending changes under `backend/prisma/`, `frontend/`, or
`.github/workflows/`.

## 3. Report-storage changes

`ReportStorage` retains local development storage and delegates to a private
S3-compatible adapter when selected. The adapter uses organization-scoped random
keys, private Get/Put/Delete operations, bounded read/write handling, checksum
validation and tenant-scoped discard. Upload succeeds before the export becomes
READY; provider details never enter the HTTP contract. Production requires explicit
S3 settings and credentials. See [report storage verification](report-storage-staging-verification.md).

## 4. Redis compatibility changes

`REDIS_URL` accepts managed `redis://` and TLS `rediss://` endpoints, decodes URL
credentials into ioredis options, and applies TLS only for `rediss://`. Production
configuration requires this URL. BullMQ receives the same validated connection
options with its required request-retry behavior. Connection strings are never
logged.

## 5. Blueprint files

`render.yaml` defines an unprovisioned staging static site, API, background worker,
private PostgreSQL 16, and private persistent Key Value instance. It uses verified
repository roots, build/start scripts, health path and SPA rewrite. Automatic
deployments are disabled with `autoDeployTrigger: off`; there is no
`preDeployCommand`, no secret value, and no custom domain.

Blueprint Auto Sync is a separate Render Dashboard setting. Leave it disabled for
controlled provisioning even though service auto-deploy triggers are off. `sync:
false` is used only directly in service `envVars`, where Render supports manual
initial entry. Render CLI/schema validation is still pending because no CLI is
installed locally. [Render Blueprint reference](https://render.com/docs/blueprint-spec)

## 6. Staging documentation

The candidate includes the staging readiness/runtime reports, infrastructure plan,
release checklist, backup/restore runbook and rollback runbook. They distinguish
VERIFIED source behavior from DOCUMENTED planning, PENDING CLOUD PROVISIONING and
PENDING LIVE VERIFICATION.

## 7. Security review

No secret values are in `render.yaml`; signing keys, S3 settings/credentials, CORS
origin and frontend API URL are `sync: false`. API/worker share matching private
runtime values; Vite receives only public `VITE_API_BASE_URL`. The proposed data
stores are private-only. The S3 plan requires encryption, HTTPS, blocked public
access, narrowly scoped Put/Get/Delete permissions, and retention that exceeds
database report expiry. The published development signing pair remains rejected in
production mode.

## 8. API contract preservation

No controllers, DTOs, frontend files, or API inventory entries changed. Current
inventory verification reports 65 implemented and 65 documented routes. The report
download contract remains application-authorized and does not expose a public object
URL.

## 9. Database migration preservation

No Prisma schema or migration file changed. The planned release uses one approved
`prisma migrate deploy` execution against a fresh isolated staging PostgreSQL 16
database; migrations are not embedded in API or worker start commands. The stricter
invoice-evidence migration still requires an empty database or reviewed legacy data.

## 10. Local test evidence

| Check                                                  | Result                                 |
| ------------------------------------------------------ | -------------------------------------- |
| Backend lint, format, build                            | PASS                                   |
| Backend full unit suite                                | PASS: 49 suites, 315 tests             |
| Focused S3/local storage, config, Redis tests          | PASS: 4 suites, 30 tests               |
| API inventory                                          | PASS: 65 implemented/documented routes |
| Frontend typecheck, lint, format, build                | PASS                                   |
| Blueprint/documentation Prettier YAML/Markdown parsing | PASS                                   |
| `git diff --check`                                     | PASS                                   |
| Local integration, HTTP E2E, queue, migration-status   | BLOCKED — INFRASTRUCTURE UNAVAILABLE   |

Docker is unavailable and guarded local PostgreSQL/Redis endpoints are not
available. These checks were not replaced by mocks or marked passed.

## 11. Hosted CI requirements

The existing `Verification` workflow is the next gate for this exact candidate
commit. Required jobs are frontend static quality, backend static quality, backend
unit, backend database/HTTP-E2E/queue integration, all four frontend Vitest shards,
simulated browser verification, and live-backend Playwright verification. Hosted
jobs provision PostgreSQL 16/Redis 7 and therefore cover the suites blocked locally.
The candidate has **not** passed hosted CI because it has not been committed/pushed.

## 12. Staging deployment prerequisites

Reviewed commit and hosted CI; approved region/plans/cost; disabled Blueprint Auto
Sync; isolated private PostgreSQL/Key Value/S3 bucket; matching API/worker secrets;
sibling HTTPS domains; exact CORS origin; controlled migration rehearsal; provider
backup/PITR and restore rehearsal; and synthetic browser/queue/report verification.

## 13. Known unverified external dependencies

Render Blueprint semantic acceptance, plan availability/pricing, private networking,
PostgreSQL TLS/pooling, Key Value reconnect/blocking behavior, S3 provider API/IAM/
lifecycle, proxy forwarding, browser cookie behavior, queue drain, backup restore
and actual deployment remain unverified.

## 14. Proposed release commit

One focused commit is reviewable:

`feat(deployment): prepare staging infrastructure and shared report storage`

It should include exactly the files listed in the release plan in this document and
no generated output, local `.env`, `dist/`, or unrelated changes.

## 15. Release approval checklist

- [ ] Review the candidate diff and this record.
- [ ] Review planned Render region, paid plans, costs and provider terms.
- [ ] Confirm no secret values and no generated files are staged.
- [ ] Create the focused commit on a release branch and open a pull request.
- [ ] Require every hosted CI job for that commit to pass.
- [ ] Record the merged main SHA before controlled staging provisioning.
