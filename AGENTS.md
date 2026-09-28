# Repository Working Rules

## Project

This is the backend-first SME Cash Flow & Invoice Management System. It is a single NestJS modular monolith written in JavaScript. The eight files in `docs/` are authoritative; `docs/repository-blueprint.md` defines repository structure and implementation boundaries.

Use `.js` for backend source and tests. Do not create `.ts` files, TypeScript interfaces, or TypeScript-only tooling. Selective JSDoc is allowed only when it materially clarifies an important contract.

## Architecture Rules

- Keep controllers thin: validate transport input, obtain trusted context, call one application use case, and map the response.
- Application services orchestrate use cases and own transaction boundaries. Pure domain logic stays outside controllers and framework objects.
- Export narrow module contracts. Redesign circular dependencies; `forwardRef` is exceptional.
- Create abstractions only for a concrete boundary or safety need. Do not add empty feature folders.

## Multi-Tenancy and Authorization

- `Organization` is the tenant boundary. A route/body `organizationId` never grants authority.
- All organization-owned access must use trusted tenant scope; cross-tenant access is forbidden and normally concealed as `404`.
- Backend RBAC uses the canonical permission constants from `docs/auth-authorization-design.md`; do not scatter role-name checks.
- Permission checks do not replace resource, lifecycle, ownership, or other domain rules.

## Financial and Database Rules

- The server is authoritative for totals, states, actors, and timestamps.
- Never use JavaScript floating point for authoritative money. Follow the documented Decimal precision, scale, rounding, and string-serialization rules.
- PostgreSQL will be the source of truth. Important financial/privileged mutations use explicit application-service transactions and transaction-scoped persistence.
- Preserve issued-document immutability, payment reversal rules, audit atomicity, tenant-safe relationships, and scoped queries.
- Controllers must never import Prisma. Never add unscoped tenant lookups.
- Prisma models and migrations preserve composite tenant foreign keys; authoritative amounts remain Prisma `Decimal` values and are never coerced to JavaScript `number`.
- Application services own transactions and every participant in a transaction uses the same transaction client. Schema changes require reviewed migrations; never edit a production database manually.
- Migrations are mandatory for schema evolution. Do not use `prisma db push` as the normal workflow; inspect generated migration SQL before applying it and preserve PostgreSQL-level tenant composite FKs, partial indexes, and financial CHECK constraints.
- Use Prisma `Decimal` for authoritative money, quantities, rates, totals, payments, and expenses; never coerce these values to JavaScript `number`.
- Database integration tests run only against the dedicated guarded `sme_cashflow_test` database. Controllers never access Prisma directly.

## Queue Rules

- Redis/BullMQ are not sources of truth and cannot determine financial correctness.
- Workers validate payloads, reload authoritative tenant-scoped database state, and tolerate retries idempotently.
- Introduce a business queue only with its owning feature. Never enqueue a dependent side effect before commit.
- Queue payloads carry versioned IDs and useful correlation metadata, never authoritative financial snapshots.
- Workers have no independent authority to mutate invoice, payment, expense, or other financial truth.
- Business processors live with their owning modules, use canonical queue-name constants, and must be retry-safe.

## Testing

- Colocate fast unit tests with pure business rules. Financial calculations require boundary and rounding tests.
- Use real PostgreSQL integration tests for constraints, transactions, locks, and concurrency when database support arrives.
- Every tenant-owned feature requires Organization A/B isolation tests. Critical public flows require Nest/Supertest E2E tests.
- Future test database helpers must reject non-test targets and never fall back from `TEST_DATABASE_URL` to a development URL.

## Security

- Validate and allowlist every API input; reject unknown fields and prevent mass assignment.
- Never log passwords, hashes, tokens, cookies, Authorization headers, secrets, PAN/CVV, request bodies, or report contents.
- Return stable safe error shapes; never expose stacks, SQL, ORM metadata, constraints, environment values, or cross-tenant existence.

## Authentication Rules

- Controllers stay thin; auth application services own session transactions and credential lifecycle decisions.
- Never log credentials, raw tokens, token hashes, cookies, or Authorization headers.
- Raw refresh tokens are never stored. PostgreSQL RefreshSession and RefreshToken hash rows are authoritative; Redis is throttling infrastructure only.
- Refresh credentials are single-use and rotation is mandatory. Reuse detection compromises and revokes the entire session family according to the documented policy.
- Access authentication must re-check current ACTIVE User and RefreshSession state. Long-lived JWT claims never contain organization memberships, roles, or permissions.

## Organization Rules

- Registration creates only a global User; organization creation is a separate authenticated action.
- Organization creation must atomically create its invoice sequence, default expense categories,
  exactly one ACTIVE OWNER Membership for the creator, and the required audit record.
- Organization access requires a current ACTIVE Membership; an `organizationId` route or body value
  never grants access by itself.
- Base currency is immutable after `currencyLockedAt`; timezone and invoice settings changes are
  versioned and audited.
- Reusable RBAC and global tenant-context infrastructure remain separate prompts; ordinary
  membership lifecycle and ownership transfer use their dedicated module.

## Membership Rules

- Membership and OrganizationInvitation records are organization-scoped; a route `organizationId`
  identifies requested scope but never establishes authorization.
- Preserve membership history with status transitions; do not hard-delete membership rows casually.
- Ordinary membership commands must never remove, suspend, demote, or otherwise leave an
  organization without its active Owner. Owner changes use the dedicated atomic transfer flow.
- Invitation credentials use cryptographically secure random tokens, but only their hashes may be
  persisted or logged. Raw invitation tokens are never included in audit metadata.
- Authorization uses only canonical permission constants and the central role-to-permission map;
  do not scatter raw role checks in controllers or application services.
- Authorization is PostgreSQL-backed on each tenant request. JWTs never carry organization roles or
  permissions, and permission caching is not introduced.
- Unknown roles or permissions fail closed. Non-member or inactive-membership tenant access is
  concealed as not found; an active member without a required permission receives forbidden.
- Service-level lifecycle, ownership, and resource rules remain mandatory after an RBAC check.
- The reusable tenant-context/query framework remains Prompt 12 work.

## Forbidden Patterns

- Business logic, manual authorization, Prisma, Redis, transactions, or financial calculations in controllers.
- Unscoped tenant queries, client-authoritative totals/status, or JavaScript `number` money.
- Scattered raw permissions/role checks, blind DTO spreading, catch-all `any`, swallowed errors, or secret-bearing logs.
- Generic `BaseRepository`, `BaseService`, `BaseController`, generic CRUD/tenant repositories, or domain base-class frameworks without proven value.
- Circular Nest modules, giant services/shared utilities, or one prompt implementing multiple unrelated modules.

## Codex Workflow

For every task:

1. Read this file and the relevant planning documents.
2. Inspect the existing implementation and working tree.
3. Implement only the requested bounded scope.
4. Run formatting, lint, focused tests, broader relevant tests, and build.
5. Inspect failures and fix only related failures.
6. Summarize changed files and behavior.
7. Report exact commands/tests and outcomes.
8. Report architectural deviations or documentation corrections.
9. Stop before beginning the next feature.
