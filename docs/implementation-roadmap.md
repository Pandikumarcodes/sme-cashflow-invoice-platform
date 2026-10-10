# Implementation Roadmap

## 1. Roadmap principles

- Implement one infrastructure concern or vertical feature at a time; do not start React.
- A phase advances only when its migrations, tests, documentation, security review, and definition of done pass.
- Establish tenant and authorization primitives before tenant business data.
- Implement the Money primitives before any persisted financial calculation, even though complete analytics follows invoices/expenses.
- Add the audit append mechanism early enough that privileged/financial modules never ship unaudited; build the full audit query API later.
- Keep financial writes synchronous in PostgreSQL transactions. Redis/BullMQ carries side effects only.
- Use production-like PostgreSQL integration tests for constraints, transactions, Decimal behavior, and concurrency.

## 2. Exact recommended order and adjustments

The required high-level sequence is retained below. Four engineering adjustments are explicit: (a) Prompt 4 finalizes `docs/repository-blueprint.md`; (b) Prompt 5 creates `AGENTS.md` together with the repository foundation instead of spending a separate implementation prompt on guidance alone; (c) Prompt 6 owns PostgreSQL/Prisma and Prompt 7 owns Redis/BullMQ connectivity, while business processors remain step 21; (d) implement the foundational Money library before invoice calculation, then expand it into the financial calculation engine at step 17. An internal audit writer still precedes privileged mutations, while the complete Audit Logs feature remains step 24.

1. Product requirements — this document set
2. Backend architecture — this document set
3. Database/domain design — this document set
4. Repository implementation blueprint — this final planning stage
5. Backend repository setup + `AGENTS.md`
6. PostgreSQL + Prisma
7. Redis + BullMQ infrastructure foundation
8. Authentication
9. Organizations
10. Memberships
11. RBAC
12. Tenant isolation
13. Customers
14. Invoices (uses foundational Money primitives)
15. Payments
16. Expenses
17. Financial calculation engine (consolidation, reconciliation, reporting functions)
18. Cash-flow APIs
19. P&L APIs
20. Analytics APIs
21. BullMQ/background jobs
22. Payment reminders
23. Reports
24. Audit logs (query/retention hardening; writer already present)
25. Security hardening
26. Integration testing and performance/concurrency suite
27. Swagger/OpenAPI
28. Production Docker
29. CI/CD
30. React frontend later — explicitly not part of this backend roadmap execution

## 3. Phase 0 — Architecture approval

### Step 1: Product requirements

- **Objective:** agree on MVP actors, lifecycle, reporting semantics, assumptions, and non-goals.
- **Dependencies:** stakeholder context only.
- **Deliverables:** `docs/product-requirements.md`; decisions on one currency, invoice immutability, cash-basis reporting, one-invoice payments.
- **Tests/review:** scenario walkthroughs and contradiction review rather than code tests.
- **Definition of done:** unresolved questions have an owner; MVP defaults are explicitly accepted or amended.

### Step 2: Backend architecture

- **Objective:** establish module boundaries, dependency direction, request/auth/tenant flows, transaction/jobs/security patterns.
- **Dependencies:** approved product baseline.
- **Deliverables:** `docs/backend-architecture.md` and diagrams.
- **Tests/review:** threat-model walkthrough, dependency-cycle review, failure-mode review.
- **Definition of done:** team agrees how each request establishes tenant and permission context and how modules communicate.

### Step 3: Database/domain design

- **Objective:** translate invariants into entities, constraints, indexes, lifecycle, and transaction boundaries.
- **Dependencies:** product and architecture.
- **Deliverables:** `docs/database-design.md`, conceptual ERD, schema decision checklist.
- **Tests/review:** sample data reconciliation, concurrent-payment and owner-transfer thought experiments.
- **Definition of done:** every financial/tenant relation and source-of-truth value is unambiguous.

**Architecture checkpoint A:** do not scaffold until product explicitly resolves or accepts the listed assumptions, especially taxes, invoice numbering, cash-basis labels, roles, and data retention ownership.

### Step 4: Repository implementation blueprint

- **Objective:** remove implementation ambiguity about the repository tree, NestJS module ownership/dependencies, shared infrastructure, transactions, context, Prisma, Redis/BullMQ, testing, and prompt boundaries.
- **Dependencies:** all seven preceding planning documents.
- **Deliverables:** `docs/repository-blueprint.md` and only necessary roadmap refinements.
- **Tests/review:** eight-document terminology, permission, lifecycle, transaction, queue, and implementation-order consistency review.
- **Definition of done:** Prompt 5 can scaffold the repository without making new architectural decisions and no application artifact has been created.

## 4. Phase 1 — Engineering foundation

### Step 5: Backend repository setup and repository guidance

- **Objective:** establish a strict NestJS/JavaScript project and quality gates without domain code.
- **Dependencies:** approved Step 4 repository blueprint.
- **Deliverables:** root `AGENTS.md`; package/toolchain pinning; source/test layout; Zod configuration validation; Pino logging/redaction; request-ID, validation, error/filter and liveness foundations; lint/format/Jest scripts; `.env.example` and README commands.
- **Tests:** boot smoke test, configuration validation unit tests, standardized error/filter test.
- **Definition of done:** clean install and all checks run deterministically; a contributor/Codex can follow repository rules; no secrets or generated artifacts are committed. Prisma, Docker services, Redis/BullMQ, business modules, authentication, Swagger, production Docker, and CI remain excluded.

### Step 6: PostgreSQL + Prisma

- **Objective:** connect the authoritative datastore and prove migration/testing workflow before full schema growth.
- **Dependencies:** repository setup; database decisions approved.
- **Deliverables:** PostgreSQL development Compose service; Prisma integration and final reviewed schema based on planning docs; first migration including reviewed PostgreSQL-specific constraints; transaction host, guarded test database lifecycle, development seed framework, and database readiness.
- **Tests:** connection/readiness, migration from empty DB, rollback behavior, Decimal mapping spike, composite relation/partial-index/check-constraint spike.
- **Definition of done:** CI can create/migrate/isolate a PostgreSQL test database and integration tests use real transactions.

### Step 7: Redis + BullMQ infrastructure foundation

- **Objective:** add reproducible local Redis and BullMQ connectivity without making API or financial correctness Redis-dependent.
- **Dependencies:** Steps 5–6.
- **Deliverables:** Redis added to development Compose, Redis lifecycle/config/health, BullMQ root connection, canonical queue names and versioned base job contract, API/worker readiness rules, environment examples, persistent-volume guidance.
- **Tests:** Redis/queue connection and shutdown, role-aware readiness, application behavior when Redis is down, clean local startup.
- **Definition of done:** documented one-command infrastructure startup; no reminder/report processor, business job, or production Docker claim exists. Durable pending-event dispatch and real business workers remain step 21.

**Architecture checkpoint B:** review dependency tree, environment/secrets model, migration escape hatches for PostgreSQL-specific constraints, and real-DB test speed before domain work.

## 5. Phase 2 — Identity, tenancy, and authorization

### Step 8: Authentication

- **Objective:** secure global identity and rotating session lifecycle.
- **Dependencies:** database/security/config foundations.
- **Deliverables:** User/RefreshSession/RefreshToken persistence, registration/login/refresh/logout/logout-all, Argon2id, JWT validation, rate-limit hooks, safe auth audit events.
- **Tests:** hash/normalization units; session rotation/reuse integration; Supertest registration/login/refresh/logout; disabled-user, expiry, malformed token, enumeration, and brute-force-policy tests.
- **Definition of done:** raw tokens/passwords never persist/log; replay revokes the family; stable `401` errors and short token lifetime are documented.

### Step 9: Organizations

- **Objective:** create and configure tenant roots with currency/timezone defaults.
- **Dependencies:** auth and transactions.
- **Deliverables:** Organization, InvoiceSequence and default categories creation; profile/settings/lifecycle APIs; organization + Owner transaction; currency-lock policy placeholder.
- **Tests:** creation rollback, invalid currency/timezone, authenticated access, lifecycle restrictions, Owner existence.
- **Definition of done:** no organization can be active without one Owner and numbering/defaults.

### Step 10: Memberships

- **Objective:** model multi-organization access and membership lifecycle.
- **Dependencies:** Users, Organizations.
- **Deliverables:** Membership and OrganizationInvitation persistence/API, secure invite acceptance, status changes, removal/reactivation, role changes, owner-transfer use case, session/authorization invalidation event.
- **Tests:** unique membership, invite token if enabled, last-owner protection, concurrent ownership transfer, removed/suspended access.
- **Definition of done:** exactly one active Owner per active tenant; historical actor relationships are retained.

### Step 11: RBAC

- **Objective:** centralize code-defined permission policies and contextual safeguards.
- **Dependencies:** Memberships and agreed matrix.
- **Deliverables:** permission constants/map, policy service, guard metadata, service authorization pattern, tests enumerating roles/actions.
- **Tests:** every matrix cell, Owner/Admin exceptions, self-escalation denial, stale-token role change.
- **Definition of done:** no domain business service contains scattered role-name conditionals; permission denial is consistent.

### Step 12: Tenant isolation

- **Objective:** make tenant scoping a structural property before business modules.
- **Dependencies:** auth, memberships, RBAC.
- **Deliverables:** immutable RequestContext, organization route guard, tenant-scoped repository conventions/helpers, composite-key conventions, negative-test harness, worker context contract.
- **Tests:** A cannot read/mutate B; UUID guessing; body/path organization manipulation; cross-tenant related IDs; inactive membership/tenant; representative repository omission tests.
- **Definition of done:** every sample tenant operation requires trusted context; unscoped request-path repositories are prohibited. RLS deferral is reviewed and recorded.

**Architecture checkpoint C:** security review the complete authentication → membership → permission → scoped-query chain before Customers or finance data.

## 6. Phase 3 — Operational finance core

### Step 13: Customers

- **Objective:** deliver the first fully tenant-scoped vertical slice.
- **Dependencies:** tenant/RBAC foundation.
- **Deliverables:** Customer CRUD/archive, validation/search/cursor pagination, optimistic version, audit writer integration.
- **Tests:** permissions, all cross-tenant attacks, duplicate optional code, archive behavior, stale update, validation bounds.
- **Definition of done:** archived customers remain readable historically and cannot be selected for new documents.

### Step 14: Invoices

- **Objective:** implement draft aggregate, deterministic calculation, issue/number/freeze, cancel/void, and derived display state.
- **Dependencies:** Customers; foundational Money/clock utilities implemented as part of this step.
- **Deliverables:** Invoice/InvoiceItem/InvoiceSequence persistence; decimal parser/rounding; draft create/update/delete; issue transaction; customer snapshot; number generation; list/detail; derived payment state/overdue; audit.
- **Tests:** table-driven money/rounding; empty/invalid lines; discount/tax boundaries; tenant/permission attacks; update rollback; concurrency-safe numbering; issue retry; immutability; cancellation/void rules; timezone overdue cases.
- **Definition of done:** client totals are never trusted; issued snapshots/number are atomic and immutable; all calculations use Decimal.

### Step 15: Payments

- **Objective:** record/reverse external receipts and maintain invoice settlement invariants.
- **Dependencies:** issued invoices, Idempotency component, audit writer.
- **Deliverables:** Payment/PaymentReversal/IdempotencyRecord persistence; record/reverse/query APIs; invoice locking; cached balance update; post-commit payment event.
- **Tests:** positive/scale/currency validation, draft/cancelled denial, partial/full payment, overpayment rejection, same-key retry and conflicting payload, double reversal, rollback, two-connection concurrent payment race, cache reconciliation, tenant/RBAC attacks.
- **Definition of done:** no execution order can produce active payments above invoice total; every effect is auditable and idempotent.

### Step 16: Expenses

- **Objective:** record paid cash outflows with clear category/lifecycle semantics.
- **Dependencies:** Money, tenant/RBAC, audit writer.
- **Deliverables:** categories/defaults, Expense create/read/update/void, cursor/filter APIs, optimistic version.
- **Tests:** amount/currency/date validation, same-tenant category, permissions, tenant attacks, void/idempotent conflict, stale edit, audit rollback.
- **Definition of done:** only active paid expenses count later; referenced categories archive safely.

**Architecture checkpoint D:** reconcile a fixture organization manually: invoice totals, partial payments, reversal, expenses, balances, derived overdue, and audit entries. Review generated SQL/index plans and transaction lock order.

## 7. Phase 4 — Financial queries

### Step 17: Financial calculation engine

- **Objective:** consolidate calculation contracts used by invoices and reporting and add reconciliation without creating a ledger.
- **Dependencies:** Invoices, Payments, Expenses.
- **Deliverables:** documented Money API, cash/receivables formula functions, date-range/timezone service, SQL aggregate/reconciliation queries, financial fixture builder.
- **Tests:** property/table tests for arithmetic; large values and scale boundaries; cache-versus-payment reconciliation; reversed/void exclusions; cross-timezone date boundaries.
- **Definition of done:** one canonical definition exists for each metric and no JS `number` touches authoritative amounts.

### Step 18: Cash-flow APIs

- **Objective:** expose actual cash inflow, outflow, net, and time series.
- **Dependencies:** Step 17.
- **Deliverables:** summary/time-bucket queries by payment/expense business date; inclusive range/tenant timezone semantics; DTO serialization.
- **Tests:** invoice issue has no cash effect; payment/reversal and expense/void effects; empty range; boundaries; tenant/permission/pagination where relevant.
- **Definition of done:** API totals reconcile to payment and expense registers and are labeled actual cash flow.

### Step 19: P&L APIs

- **Objective:** expose simplified cash-basis management performance without accounting compliance claims.
- **Dependencies:** Cash-flow definitions.
- **Deliverables:** collected revenue, paid expenses/category breakdown, net cash-basis performance, disclosure metadata.
- **Tests:** same inclusion/exclusion/range fixtures, category breakdown reconciliation, negative result, no-data range.
- **Definition of done:** endpoint/report explicitly says cash-basis/simplified and never claims GAAP/IFRS net income.

### Step 20: Analytics APIs

- **Objective:** receivables, aging, total invoiced/collected/expenses, collection rate, payment delay.
- **Dependencies:** financial engine and clarified cohort definitions.
- **Deliverables:** dashboard summary and bounded trends; receivables aging as-of behavior; query/index review.
- **Tests:** aging bucket boundaries, partial/overdue/paid cases, cohort collection-rate semantics, final-payment delay, large fixture performance, tenant/RBAC attacks.
- **Definition of done:** metrics reconcile and response metadata states dates/as-of/currency/sample sizes.

**Architecture checkpoint E:** finance/product reviewer signs off formulas, labels, date semantics, sample reconciliation, and query plans before exposing reports or reminders.

## 8. Phase 5 — Asynchronous capabilities and reports

### Step 21: BullMQ/background jobs

- **Objective:** reliable typed job infrastructure for side effects.
- **Dependencies:** Redis, database, tenant job context, PendingEvent decision.
- **Deliverables:** queues/workers, versioned schemas, retry/backoff/dead-letter conventions, transactional pending-event dispatcher, job logging/metrics, graceful shutdown.
- **Tests:** duplicate delivery, retryable/permanent failure, stale/malformed payload, tenant scoping, dispatcher crash between claim/delivery, Redis outage recovery.
- **Definition of done:** at-least-once processing produces at-most-one business side effect through idempotency; no financial write is moved to a queue.

### Step 22: Payment reminders

- **Objective:** generate due/overdue in-app reminders and provider-ready emails.
- **Dependencies:** invoices/payments, jobs, notifications.
- **Deliverables:** Notification/ReminderDelivery persistence, tenant-local scheduler, eligibility/suppression, in-app API, email provider interface/config gating.
- **Tests:** due/overdue timezone boundary, paid/cancelled suppression, semantic deduplication, retries, role/job tenant attacks, provider failure.
- **Definition of done:** repeated scans/deliveries do not duplicate reminders; current invoice state is rechecked in worker.

### Step 23: Reports

- **Objective:** deliver authorized CSV registers and financial summaries.
- **Dependencies:** analytics definitions and jobs for large exports.
- **Deliverables:** invoice, receivable, payment, expense, cash-flow and cash-basis-performance CSV; streaming limits; ReportExport state/storage abstraction; authorized download.
- **Tests:** CSV formula-injection escaping/encoding, totals, filters/ranges, synchronous limits, worker retry/idempotency, guessed/cross-tenant export ID, expired link/file cleanup.
- **Definition of done:** exports match APIs/source facts, are private, bounded, and audited; PDF remains out of scope.

### Step 24: Audit logs

- **Objective:** complete tenant audit search/read, immutability, redaction, and retention after the early append writer has covered prior mutations.
- **Dependencies:** all action vocabulary and audit writer.
- **Deliverables:** canonical action catalog, tenant-scoped query API, indexes, permission, redaction allowlists, database grants/retention job, worker/system attribution.
- **Tests:** every required mutation emits one correct entry in its transaction; rollback emits none; secrets never appear; normal app cannot update/delete; cross-tenant and permission tests.
- **Definition of done:** privileged/financial action coverage is enumerated and verified; audit data is append-only in normal flows.

**Architecture checkpoint F:** operational review of retry/dead-letter behavior, email data handling, report storage/download authorization, and audit completeness.

## 9. Phase 6 — Production readiness

### Step 25: Security hardening

- **Objective:** close known application/deployment threats before release.
- **Dependencies:** complete API surface.
- **Deliverables:** threat model, rate limits, CORS/CSRF/cookies/headers, JWT key rotation runbook, secret redaction, dependency scanning, least-privilege database roles, PII map, backup/restore and incident notes.
- **Tests:** auth abuse, IDOR matrix, mass assignment, oversized/malformed payloads, CSV injection, error leakage, revoked/stale sessions, report URL access, security-header checks.
- **Definition of done:** high findings resolved; accepted risks have owners/dates; no card data path exists.

### Step 26: Integration and system testing

- **Objective:** run the complete real-service regression, concurrency, recovery, and representative performance suite.
- **Dependencies:** all MVP features.
- **Deliverables:** PostgreSQL/Redis integration suite, Supertest E2E journeys, concurrency suite, reconciliation suite, coverage thresholds focused on risk, seed/load fixtures.
- **Tests:** full tenant A/B matrix, roles, all transactions/rollbacks, concurrent issue/payment/ownership, worker duplicate/failure, timezone/rounding boundaries, migration from clean DB, representative query latency.
- **Definition of done:** zero invariant/reconciliation failures, stable non-flaky CI suite, documented test runtime and known gaps.

### Step 27: Swagger/OpenAPI

- **Objective:** publish an accurate API contract for the later frontend.
- **Dependencies:** stabilized APIs/error shapes.
- **Deliverables:** OpenAPI auth schemes, DTOs, parameters, decimal-string schemas, error examples, idempotency/version headers, downloadable spec.
- **Tests:** spec generation/validation; contract smoke tests; no undocumented endpoint/response drift.
- **Definition of done:** a frontend engineer can integrate without reading internal code; sensitive/internal routes are excluded.

### Step 28: Production Docker

- **Objective:** create minimal reproducible API/worker images and safe runtime behavior.
- **Dependencies:** stable build and health model.
- **Deliverables:** multi-stage non-root images, API/worker commands, health/readiness, graceful shutdown, migration deployment strategy, image scanning, pinned runtime.
- **Tests:** clean image build, container smoke/E2E, SIGTERM transaction/job handling, read-only filesystem where feasible, vulnerability threshold.
- **Definition of done:** images contain no source secrets/dev tooling and run with external PostgreSQL/Redis configuration.

### Step 29: CI/CD

- **Objective:** automate safe verification, image publication, migration, and deployment promotion.
- **Dependencies:** production images and complete checks.
- **Deliverables:** install/lint/unit/integration/E2E/spec/scan/image stages; migration review/deploy step; environment approvals; rollback/forward-fix and backup plan.
- **Tests:** pipeline on clean runner, failed migration simulation, artifact provenance, deployment smoke/readiness.
- **Definition of done:** no production deployment can bypass required tests/scans/approval; database change procedure is documented and rehearsed.

### Step 30: React frontend later

- **Objective:** consume the reviewed OpenAPI after backend MVP acceptance.
- **Dependencies:** Step 27 and backend release readiness.
- **Deliverables/tests/definition of done:** deliberately deferred to a separate frontend plan. No React code is created by this roadmap.

**Release checkpoint G:** product, finance-rules, security, operations, and API-contract reviews approve a release candidate; restore test and incident contacts are complete.

## 10. Suggested future prompt-sized work items

Each item should be a separate implementation/review prompt where practical:

1. Prompt 5: create `AGENTS.md` and scaffold only the strict NestJS quality/config/logging/request-ID/error/health foundation.
2. Prompt 6: add Docker development PostgreSQL, the final reviewed Prisma schema/first migration, transaction host, guarded test database, seed framework, readiness, and Decimal/constraint tests.
3. Prompt 7: add Docker development Redis, Redis/BullMQ root connectivity, queue names/base job contracts, role-aware health, graceful shutdown, and outage tests—no business processor.
4. Implement User/RefreshSession/RefreshToken persistence and security primitives.
5. Implement registration/login, then refresh/reuse/logout in a separate slice.
6. Implement Organization creation transaction/settings and the audit append foundation.
7. Implement Membership/invitation lifecycle and ownership transfer.
8. Implement canonical permission policy and guards.
9. Implement trusted tenant RequestContext and the tenant-isolation adversarial harness.
10. Implement Customers vertical slice.
11. Implement Money primitives and exhaustive unit tests.
12. Implement invoice draft/items calculation.
13. Implement invoice issue/number/freeze and concurrency tests.
14. Implement invoice cancel/void and derived states.
15. Implement idempotency component.
16. Implement payment recording/concurrent locking.
17. Implement payment reversal/reconciliation.
18. Implement expense categories/expenses.
19. Implement the Financial engine, then each Cash Flow, P&L, and Analytics read family separately.
20. Implement durable pending-event dispatch and real BullMQ worker bootstrap.
21. Implement notifications/reminders, then reports/exports in separate prompts.
22. Complete audit query/retention hardening.
23. Perform dedicated security, system-test, OpenAPI, production-container, and CI prompts.

## 11. Principal risks and mitigations

| Risk | Consequence | Mitigation/checkpoint |
|---|---|---|
| Forgotten tenant filter | Cross-tenant data breach | Scoped repository signatures, direct tenant keys/composite FKs, adversarial suite, review gate C |
| Floating/rounding inconsistency | Incorrect invoices/reports | Decimal-only Money module, string API, table/property tests, gate D/E |
| Concurrent payment race | Overpaid invoice/cache drift | Invoice row lock, recompute active sum, same lock order, two-connection tests |
| Issued invoice mutation | Broken audit/history | immutable service transitions, DB constraints where feasible, API/integration tests |
| Duplicate retries/jobs | Duplicate cash record/email/export | transactional idempotency/outbox, semantic job keys, at-least-once tests |
| Misleading P&L | Bad decisions/legal exposure | “simplified cash-basis” label and reconciliation/disclosure review |
| Prisma hides needed DB constraints | Weaker invariants | reviewed SQL migration extensions and integration tests |
| Audit contains secrets/PII | Security/privacy incident | field allowlists, redaction tests, no request-body logging |
| Scope expansion | Incomplete/fragile MVP | preserve non-goals; defer FX, ledger, gateways, PDF, custom roles |
| Redis outage affects core writes | Availability loss | PostgreSQL authoritative; post-commit pending events; degrade async features |
| Timezone/date ambiguity | Boundary errors | date-only business fields, IANA timezone, deterministic clock tests |
| Retention policy unknown | Compliance/erasure conflict | resolve before launch; separate operational and financial retention |

## 12. Global definition of done

A backend feature is done only when:

- its requirements and permission are named;
- DTO validation and stable errors exist;
- all tenant queries use trusted organization context;
- financial math uses Decimal and documented rounding;
- required transaction/idempotency/audit behavior is implemented;
- unit, real-database integration, API, authorization, and tenant-negative tests appropriate to its risk pass;
- migrations and indexes are reviewed from a clean database;
- logs/metrics contain useful safe context and no secrets;
- API documentation and operational notes are updated;
- lint, formatting, tests, and security checks pass in CI.

# Prompt 1 Review Checklist

- [ ] Confirm the MVP/non-goals and that no React work begins.
- [ ] Confirm one base currency per organization and when it becomes locked.
- [ ] Confirm tax/discount model and required legal invoice fields.
- [ ] Confirm persisted statuses (`DRAFT`, `ISSUED`, `CANCELLED`, `VOID`) and derived payment/overdue states.
- [ ] Confirm issued invoice immutability, cancellation/void semantics, and no issued deletion.
- [ ] Confirm tenant invoice sequence never resets, permits gaps, and assigns at issue.
- [ ] Confirm one payment belongs to one invoice, overpayments are rejected, and corrections use reversal.
- [ ] Confirm invoice balance cache plus active-payment reconciliation.
- [ ] Confirm expenses represent paid cash outflows.
- [ ] Confirm cash-flow and P&L are simplified cash-basis management reporting, not GAAP/IFRS accounting.
- [ ] Confirm inclusive business-date ranges use organization timezone.
- [ ] Confirm role/permission matrix, especially Member issue rights and Viewer analytics rights.
- [ ] Confirm organization ID in routes never grants access and membership is rechecked.
- [ ] Accept application-level tenant isolation without initial PostgreSQL RLS, or request revision.
- [ ] Confirm direct `organizationId` on security-sensitive child tables and composite constraints.
- [ ] Confirm financial transaction/locking/idempotency boundaries.
- [ ] Decide whether invitations, email verification, and password reset are MVP or pre-public-launch.
- [ ] Resolve retention/privacy ownership, reminder policy/provider, and report size limits.
- [ ] Confirm CSV before PDF and no direct card processing.
- [ ] Approve architecture checkpoints and prompt-sized implementation order before Prompt 2.

## Prompt 17 implementation sequencing note

The user's explicit Prompt 17 Cash Flow request implements the Cash Flow route
otherwise listed at Step 18. It introduces only the narrow FinancialModule read
contract needed by that route and preserves the repository blueprint's module
boundary. This is not completion of Step 17's broader financial consolidation or
reconciliation scope. Simplified P&L (Step 19) and all later features remain
unimplemented; no Prompt 18 work is included in this milestone.

## Prompt 18 implementation sequencing note

The explicit Prompt 18 request implements simplified cash-basis P&L, otherwise
listed at roadmap Step 19. It extends FinancialModule's narrow read contracts and
reuses Cash Flow source calculations. This does not complete broader accounting
or financial-engine consolidation. At that milestone, Analytics and subsequent
features were deferred; the Prompt 19 delivery is recorded below.

## Prompt 19 implementation sequencing note

The explicit Prompt 19 request delivers summary and receivables-aging analytics,
otherwise listed at Step 20. Canonical period cash totals remain shared with Cash
Flow/P&L; cohort, delay, source-derived balances and aging are read-time aggregates.
Current-state business-date as-of semantics are explicit; historical timestamp
reconstruction and comparisons are deferred. No user Prompt 20 work is included.

## Prompt 20 implementation sequencing note

The explicit Prompt 20 request combines the minimum durable-event/worker foundation
needed by Notifications with the reminder capability listed at Steps 21-22. It adds
recipient inbox APIs, due/overdue occurrences, supported source-event consumption,
scoped delivery rechecks and provider-gated capture. Reports/export handlers were
deferred at that milestone; Prompt 21 delivery is recorded below.

## Prompt 21 implementation sequencing note

The explicit Prompt 21 request delivers Step 23's eight report/export routes and
six CSV types. Financial source contracts, durable PendingEvent dispatch and
separate owning report workers are reused. Private local artifacts, bounded
generation, authorized/audited downloads and lazy expiry use the existing schema.
Object storage deployment, file retention cleanup, PDF, Audit Log APIs, frontend,
AI and user Prompt 22 remain deferred. See reports-implementation.md for decisions.
