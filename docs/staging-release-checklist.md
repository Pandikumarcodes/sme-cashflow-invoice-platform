# Staging release checklist

Status: **DOCUMENTED; do not execute this checklist without approval.** Use only
synthetic accounts, organizations, customers and financial data.

## Approval and provisioning

- [ ] Blueprint, region, plans, cost estimate, provider terms, and custom-domain
      decision reviewed and approved.
- [ ] Staging GitHub Environment and distinct staging secrets approved.
- [ ] Private PostgreSQL, Key Value, S3-compatible bucket/prefix, API, worker, and
      static site provisioned; no production resources reused.
- [ ] Bucket is private, encrypted, HTTPS-only, least-privilege scoped to
      `PutObject`/`GetObject`/`DeleteObject`, lifecycle is longer than report expiry,
      multipart cleanup and orphan reconciliation plans are configured.
- [ ] API/worker have identical report-storage and signing values; frontend has only
      public `VITE_API_BASE_URL`.

## Database and process release

- [ ] Fresh PostgreSQL 16 target identity, backup/PITR policy and migration plan
      approved.
- [ ] Controlled migration rehearsal succeeds with `prisma migrate deploy`; no
      automatic replica migration is enabled.
- [ ] Verify precision, tenant FKs, invoice numbering/lifecycle/idempotency
      constraints, indexes and audit trigger.
- [ ] API starts; `/api/v1/health/live` and `/api/v1/health/ready` return 200.
- [ ] Worker starts independently with no public HTTP endpoint; queue registration,
      retry/backoff, Redis reconnect, graceful restart and failed-job monitoring work.

## Browser, tenant, and financial verification

- [ ] HTTPS sibling domains, exact credentialed CORS origin, proxy behavior,
      Secure/HttpOnly/SameSite-Lax refresh cookies, rotation and logout verified.
- [ ] Direct navigation and refresh work for authenticated routes; static missing
      assets remain 404; workspace switching clears previous tenant data.
- [ ] Synthetic registration, organization creation, membership RBAC, customers,
      invoice draft/issue, concurrent invoice numbering, payments, full reversals,
      expense categories/expenses, Cash Flow, P&L, Aging, notifications, audit logs,
      idempotency and cross-tenant 404 concealment are evidenced.
- [ ] CSV report worker upload, API download, foreign-tenant denial, checksum/expiry,
      S3 delete and API/worker restart behavior are evidenced.
- [ ] Backup restore rehearsal passes to an isolated database and is recorded.

## Acceptance evidence

- [ ] Record commit/artifact IDs, migration version, configuration references,
      request IDs, health results, queue/report results, recovery evidence, operator,
      timestamps, cost decision, and formal staging acceptance.
