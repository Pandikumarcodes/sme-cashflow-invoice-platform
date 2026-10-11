# Repository restructure — Prompt 2.5

This is a structural migration of the completed backend and frontend. Existing
uncommitted frontend work is retained. No product feature, API, migration, domain
logic, authentication policy, authorization policy or queue behavior is changed.

## Layout and preservation

```text
repository/
  backend/                  # Independent JavaScript NestJS package
    src/
    prisma/
    test/
    scripts/
    package.json
    package-lock.json
    babel.config.cjs
    eslint.config.mjs
    jest*.config.cjs
    .prettierrc
    .prettierignore
    .env.example
    README.md
  frontend/                 # Existing independent React/TypeScript package
  docs/                     # Shared contracts, plans and verification notes
  README.md
  AGENTS.md
  .editorconfig
  .gitignore
  docker-compose.yml
```

Backend directories/configuration previously at root now live under `backend/`.
Git records 281 content-preserving renames. Ignored backend `.env`, `node_modules/`,
`dist/` and `.private/` also move intact; no generated/private files are deleted.
Frontend application/configuration files stay in place and keep their contents;
only its README receives the new backend setup link. Editor settings stay at root.
No root npm package, workspaces or extra monorepo tooling is introduced.

The pre-move SHA-256 manifest covers 347 tracked, frontend and private/environment
files. After relocation, 335 match byte-for-byte, 12 contain the specifically
reviewed documentation/path edits, and none are missing or unexpectedly changed.
Schema, three SQL migrations, backend source/tests, environment values, frontend
source/configuration and Compose retain their contents. Existing Git history is
not rewritten; no commit, stash, reset, clean or forced checkout is performed.

## Path changes

- The inventory checker reads shared `../../docs/api-inventory.md` from
  `backend/scripts/`.
- Backend `infra:up`/`infra:down` explicitly use `--env-file .env -f
../docker-compose.yml`. The root Compose location, project identity, services,
  volume names and data remain unchanged. There is no Dockerfile/build context.
- Backend npm, Node, Prisma, Jest, API and worker commands run from `backend/`.
  Existing relative imports, Jest patterns, schema lookup, seed, environment
  loading and `dist/` startup paths move together without code changes.
- Relative `.private/reports` remains relative to the backend working directory,
  with original private storage moved there. Absolute configured paths remain
  absolute. API and worker must share storage configuration and working directory.
- Root README, contributor instructions and relevant planning documents define
  backend-relative code paths. Backend setup lives in [backend README](../backend/README.md);
  frontend setup remains [frontend README](../frontend/README.md).

## Verification

Commands run from their owning package. Database suites run sequentially against
the unchanged guarded `sme_cashflow_test` configuration; no migration/reset/schema
recreation is performed. Native PostgreSQL and local Redis are reachable through
the existing local configuration.

| Check                                                         | Result                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend `npm.cmd ls --depth=0`                                | Dependencies resolve from backend/node_modules; no reinstall/version change                                                                 |
| Prisma validate/generate via local CLI with `--env-file=.env` | Passed; generated client under backend/node_modules                                                                                         |
| Prisma development and guarded test migration status          | Passed; all three migrations current                                                                                                        |
| Backend lint, formatting, build                               | Passed; 223 JavaScript files compiled                                                                                                       |
| Backend unit tests                                            | 48 suites / 308 tests passed; baseline retained                                                                                             |
| Backend PostgreSQL integration                                | 15 suites / 134 tests passed; baseline retained                                                                                             |
| Backend E2E                                                   | First two full runs: 76/77 tests; final run: 74/77 after a database interruption. All 77 tests passed across runs; no fully green full run. |
| Backend queues                                                | 3 suites / 8 tests passed on full rerun; first run had one completed-job timing assertion failure                                           |
| Built API/worker startup                                      | Passed with temporary process-only signing keys; API readiness/CORS passed; all five worker processors initialized and closed               |
| API inventory                                                 | 65 implemented / 65 documented routes verified                                                                                              |
| Frontend typecheck, lint, formatting, build                   | Passed                                                                                                                                      |
| Frontend isolated tests                                       | 8 files / 100 tests passed; baseline retained                                                                                               |
| Git cached/working-tree diff checks                           | Passed                                                                                                                                      |
| Docker Compose config validation                              | Unavailable: Docker CLI is missing; Compose content unchanged                                                                               |

Existing Prisma 6 warnings about package-level configuration and the required
tenant-composite SET NULL relation remain documented baseline caveats; no schema
or tooling migration is introduced. Frontend Prompt 3 is not started.

Exact package verification commands (from `backend/`):

```powershell
npm.cmd ls --depth=0
node.exe --env-file=.env node_modules/prisma/build/index.js validate
node.exe --env-file=.env node_modules/prisma/build/index.js generate
node.exe --env-file=.env node_modules/prisma/build/index.js migrate status
npm.cmd run db:migrate:status:test
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
npm.cmd run build
npm.cmd run verify:api-inventory
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run test:e2e -- --runTestsByPath test/expenses.e2e-spec.js
npm.cmd run test:e2e
npm.cmd run test:e2e -- --runTestsByPath test/memberships.e2e-spec.js
npm.cmd run test:queues
npm.cmd run test:queues
npm.cmd run test:e2e
```

The first E2E run passed 76/77 tests with one 30-second expense workflow timeout.
The unchanged expense suite passed all six tests on the focused rerun.
The full E2E rerun passed 76/77 tests, with a different 30-second timeout in the
membership database-cleanup hook. The unchanged membership suite passed all six
tests on a focused rerun. All 77 tests have passed across these runs, but neither
full run was completely green. A PostgreSQL activity check found no blocking
sessions at the time checked; one connection was waiting for data-file extension.
The cause of the intermittent delays is not established. A third full run
finished with 13/14 suites and 74/77 tests passed. It encountered PostgreSQL
becoming unreachable at `localhost:5432` during audit-test
setup, followed by fixture conflicts after the failed cleanup. A subsequent
connection probe reached the configured test database again. Native port `7498`
was also checked with the preserved configured credentials and rejected
authentication, so it was not substituted and environment values were not changed.

The first queue run passed 7/8 tests: notification durable state had reached `SENT`
before its immediate completed-job assertion observed BullMQ completion. The
unchanged full queue suite passed 3/3 suites and 8/8 tests on rerun. No timing,
worker or domain code was changed to obtain a pass.

Built API composition, readiness and credentialed CORS passed (HTTP 200, expected
origin, credentials allowed), with an ephemeral listening port and generated
Ed25519 keys supplied only to the smoke-check process. Direct startup with the
preserved `.env` failed validation because `AUTH_ACCESS_PRIVATE_KEY_BASE64` and
`AUTH_ACCESS_PUBLIC_KEY_BASE64` are missing. This existing local configuration must
be completed before normal API/worker startup; environment contents are unchanged.

Built `WorkerModule` composition also initialized and closed successfully: four
notification processors and one report processor. This check used only guarded
`DATABASE_URL_TEST` (`sme_cashflow_test`), temporary process-only signing keys,
disabled reminders/email and a unique random Redis queue prefix. Workers were
closed and only that temporary namespace was cleaned up; existing queues were
untouched. These smoke checks instantiate the compiled Nest modules directly;
they do not claim normal startup succeeds with the incomplete local `.env`.

Frontend commands (from `frontend/`):

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run format:check
npm.cmd run test
npm.cmd run build
```

Root checks:

```powershell
git diff --check
git diff --cached --check
docker compose --env-file backend/.env -f docker-compose.yml config --quiet
```

The Docker command could not execute because the Docker CLI is not installed.
