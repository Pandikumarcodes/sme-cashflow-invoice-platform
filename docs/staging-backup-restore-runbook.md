# Staging PostgreSQL backup and restore runbook

Status: **DOCUMENTED; PENDING PROVIDER VERIFICATION.** No backup or restore has
been executed.

## Preconditions

- Approved staging change, named operator, isolated restore target, and provider
  backup/PITR capability confirmed for the selected paid plan.
- Record expected RPO/RTO, database identity, migration version, application commit,
  connection limit, storage encryption, and private-network restrictions.
- Confirm a pre-change recovery point before a risky migration. Never restore over
  the live staging database or use production data for staging.

## Routine backup review

1. Confirm automated backup schedule, retention, PITR window and owner in the
   provider dashboard.
2. Record the latest successful recovery point and alert destination.
3. Confirm backup access is limited to approved operators and that database public
   access remains disabled.
4. Before migration, record the current schema/migration state and ensure the
   chosen restore point precedes the change.

## Isolated restore rehearsal

1. Create a separate private restore database; do not reuse API/worker credentials.
2. Restore a selected staging recovery point into that database under provider
   supervision.
3. Validate migration history and `prisma migrate status` against the restored copy.
4. Validate Decimal precision, tenant composite FKs, invoice numbering uniqueness,
   invoice lifecycle CHECK constraints, idempotency uniqueness, report/audit rows,
   required indexes, and append-only audit trigger.
5. Run application connectivity with temporary isolated credentials and synthetic
   read-only checks. Do not point normal staging processes at the restored copy.
6. Record restore duration, data point, validation evidence, gaps, and decision on
   whether RPO/RTO are met. Destroy the isolated copy only under an approved
   provider-safe procedure.

## Migration failure and recovery decisions

Stop rollout if migration status, required constraints, readiness, or financial
integrity checks fail. Prefer a reviewed forward corrective migration when data is
recoverable. Use restore/PITR and deliberate cutover only for material corruption.
Never use `prisma migrate reset`, `db push`, or a destructive rollback as routine
recovery. An application artifact rollback does not reverse database schema.

## Evidence required for a verified runbook

Provider plan/retention proof, timestamped restore target identity, migration status,
constraint/index/trigger checks, synthetic application check, elapsed time, operator,
and recorded RPO/RTO conclusion. Until then this runbook remains documented only.
