# GitHub Actions verification

`.github/workflows/verification.yml` is the single PR and `main`-branch verification workflow, and is also dispatchable manually. It runs on `ubuntu-latest` with Node 24 and read-only `contents` permission. It has no deployment environment, credential, or repository-write permission.

## Jobs

| Job                    | Coverage                                                       |
| ---------------------- | -------------------------------------------------------------- |
| `frontend-quality`     | TypeScript, ESLint, Prettier, and production build.            |
| `frontend-vitest`      | The complete frontend Vitest regression suite in four shards.  |
| `browser-verification` | Playwright with its simulated API.                             |
| `backend-quality`      | Prisma generation, ESLint, Prettier, build, and API inventory. |
| `backend-unit`         | Backend Jest unit tests.                                       |
| `backend-integration`  | Database integration, HTTP E2E, and queue tests.               |
| `live-integration`     | Playwright against the built backend and worker.               |

Each job installs only the lockfile of the app it exercises and uses the matching npm dependency cache. Frontend and backend remain independent npm projects.

## Test isolation and sharding

`frontend-vitest` records `vitest list` output then runs the corresponding `--shard=N/4` selection with one forks-pool worker. The four deterministic shards cover the complete suite. This is an Ubuntu CI strategy for the Windows worker-contention diagnosis; it does not increase timeouts or skip failures. Failed shards retain their inventory and log for seven days.

Database, HTTP E2E, and queue suites intentionally run sequentially because they share one guarded database. Jobs needing stateful infrastructure start PostgreSQL 16 and Redis 7 service containers. The only configured target is local `sme_cashflow_test`; `backend/scripts/prepare-ci-env.js` requires CI, rejects production, verifies that target, creates `.env` only when absent, and generates ephemeral Ed25519 keys. Redis supports queues only; PostgreSQL remains authoritative.

The live browser job migrates the isolated database, builds the backend, and starts the built API/worker plus the frontend live server. Simulated Playwright needs no database service. Both browser jobs install Chromium with Playwright's Linux setup.

## Security and artifacts

CI uses read-only permissions, safe CI-only database credentials, ephemeral signing keys, and no production/deployment credentials. It never prints `.env` contents. Only failures upload Playwright reports/results and Vitest logs, for seven days; successful runs do not upload reports that might contain fixture information.

## Local validation and hosted status

Local configuration validation consists of YAML parsing, workflow/script/path checks, and the frontend Vitest inventory command; it does not require a full regression run. Database and browser integration runs require Docker-compatible PostgreSQL/Redis and the same guarded test URL, never development or production.

The recovered configuration has not been executed by GitHub Actions from this working tree. A PR or manual dispatch is required to establish hosted Ubuntu results and investigate any application-test failures.
