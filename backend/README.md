# Backend

JavaScript NestJS modular monolith. Shared contracts, feature notes and architecture remain in the [root README](../README.md) and [planning documents](../docs/repository-blueprint.md).

Run commands from `backend/`. This package owns `src/`, `prisma/`, `test/`, `scripts/`, `.env`, `node_modules/`, `dist/` and `.private/`. Relative report storage stays `.private/reports` within this directory; existing artifacts move with it. API and worker must use the same working directory/storage configuration. Absolute configured storage paths retain their original meaning.

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run infra:up
npm.cmd run db:generate
npm.cmd run db:migrate:deploy
npm.cmd run start:dev
```

Copy the example only during fresh setup; preserve existing local values. `infra:up` uses the unchanged root Compose file and this package's `.env`. From repository root, the equivalent is `docker compose --env-file backend/.env -f docker-compose.yml up -d postgres redis`. Existing named volumes and Compose project remain unchanged. There is no application Dockerfile or container build context.

Nest Config loads this directory's `.env`; worker and infrastructure-backed test scripts also explicitly load it. Prisma discovers this package's `prisma/schema.prisma`, migrations and seed. The frontend stays on `http://localhost:5173`, API on `http://localhost:3000/api/v1`, with unchanged credentialed CORS/cookies.

```powershell
npm.cmd run format:check
npm.cmd run lint
npm.cmd run test
npm.cmd run build
npm.cmd run verify:api-inventory
node.exe --env-file=.env node_modules/prisma/build/index.js validate
node.exe --env-file=.env node_modules/prisma/build/index.js generate
npm.cmd run db:migrate:status:test
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run test:queues
```

Run integration, E2E and queue suites sequentially; database tests require the guarded local `sme_cashflow_test` target via `DATABASE_URL_TEST`. Queue suites also require Redis. Folder restructuring needs no migration or reset; never recreate the schema or delete infrastructure volumes for this move.

Run a built API with `npm.cmd run start:prod`; run the independent worker with `npm.cmd run start:worker` or `npm.cmd run start:worker:prod`. Production environment is supplied externally. Install/run the frontend separately using [frontend setup](../frontend/README.md).
