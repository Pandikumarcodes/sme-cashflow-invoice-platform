# Staging rollback runbook

Status: **DOCUMENTED; PENDING LIVE VERIFICATION.** Preserve the last known-good
frontend/API/worker artifacts, commit identifier, migration state, and secret
references before every release.

## Frontend

Roll back only to a compatible immutable static artifact. Confirm deep links,
correct `VITE_API_BASE_URL`, cache invalidation, login/logout, and CSV download.
Do not roll back to an artifact incompatible with the active API contract.

## API and worker

Stop new release progression on failed readiness, error-rate, queue, or security
signals. Roll back API and worker as a compatible pair where queue payload handling
changed. Send SIGTERM and allow the configured graceful period: workers call
`close()` to finish active jobs before queues, Redis and Prisma close. If forced
termination occurs, BullMQ’s stalled-job recovery and durable PostgreSQL event state
must be observed after a replacement worker starts. Do not delete queues, Redis data,
or pending events to make a release appear healthy.

## Runtime configuration and storage

Restore the prior reviewed secret/configuration references through the provider audit
trail. Validate exact CORS origin, proxy policy, database/Redis URLs and matching
API/worker report-storage values. For object-store faults, stop new report requests
if safe delivery cannot be guaranteed; retain private objects and database metadata
for investigation. Never make the bucket public, loosen tenant checks, or delete a
prefix wholesale.

## Database migrations

Do not reverse a migration automatically. The invoice-evidence migration prevents an
older binary from safely writing non-draft documents after it is applied. Use a
forward corrective migration for recoverable defects. Escalate to approved isolated
restore/PITR cutover for corruption, with reconciliation of durable pending events,
reports, audits and released artifacts.

## Evidence

Record trigger, affected version/configuration, health/readiness, queue state,
in-flight-job result, migration state, report-storage state, operator, timestamps,
and post-rollback synthetic verification.
