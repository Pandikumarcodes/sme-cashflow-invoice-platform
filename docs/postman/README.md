# SME Fintech Postman toolkit

65 unique requests cover the 65 registered HTTP routes, with no added endpoints.
This is a manual developer toolkit for disposable local data. Each request includes
authentication, permission, path/query inputs, the actual success status, response
checks, concurrency headers, and error notes. Backend behavior is unchanged.

Sources: [API inventory](../api-inventory.md), [API contracts](../api-contracts.md),
[domain rules](../domain-rules.md), [authorization](../auth-authorization-design.md),
and the current controllers, DTOs, response mappers, services, and API E2E tests.
Implemented contracts take precedence over historical planning recommendations.

## Files and coverage

Import `SME-Fintech.postman_collection.json` and
`SME-Fintech.local.postman_environment.json` using Postman's **Import** action.
Select the imported local environment. `generate.mjs` maintains explicit examples
and regenerates those two files. `verify.mjs` checks their contracts offline.

| Folder                      | Requests |
| --------------------------- | -------: |
| Health                      |        2 |
| Authentication              |        6 |
| Organizations               |        5 |
| Memberships and Invitations |       10 |
| Customers                   |        5 |
| Invoices                    |        8 |
| Payments and Reversals      |        4 |
| Expense Categories          |        4 |
| Expenses                    |        5 |
| Cash Flow and Profit & Loss |        3 |
| Receivables Aging           |        1 |
| Notifications               |        3 |
| Reports and CSV Exports     |        8 |
| Audit Logs                  |        1 |
| **Total**                   |   **65** |

Analytics summary is grouped with cash flow and P&L; aging has its own folder.
Categories and expenses split the backend Expenses module for navigation.

## Start local services

Use Node/npm versions from [backend/package.json](../../backend/package.json),
Docker with Compose, and the existing backend setup. From repository root:

```powershell
Set-Location backend
npm.cmd ci
# Fresh setup only; preserve an existing .env:
Copy-Item .env.example .env
```

Configure the ignored `.env`, including PostgreSQL/Redis connection values and
the signing keys described in the [root setup guide](../../README.md). Never put
keys or database credentials in the Postman environment. Then, from `backend/`:

```powershell
npm.cmd run infra:up
npm.cmd run db:generate
# Review any pending migration SQL before applying it to your local database.
npm.cmd run db:migrate:deploy
npm.cmd run start:dev
```

`infra:up` starts PostgreSQL and Redis using root Compose and `backend/.env`;
it preserves existing volumes. In another terminal, also from `backend/`:

```powershell
npm.cmd run start:worker
```

API and worker must share the same environment and report storage directory
(`.private/reports` by default, relative to `backend/`). Check both Health requests:
200 `{ "status": "ok" }`; readiness returns safe 503 when a dependency fails.
These commands start development services; they do not provision or reset the
guarded test database. Backend database suites use the repository's dedicated
`sme_cashflow_test` helper and its actual `DATABASE_URL_TEST` configuration.

## Configure local variables

All credentials, IDs, versions, and keys in the committed environment are empty.
The only populated values are public local URLs. Use local unshared values;
mark credentials sensitive and do not export populated environments, responses,
cookie jars, run reports, or console traffic to the repository. Scripts never
log responses or capture credentials. Postman itself can retain request/response
history, including auth responses; keep it private and clear it when finished.

| Variables                                                                                         | Use                                                                                                 |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `baseUrl`                                                                                         | `http://localhost:3000/api/v1`, no trailing slash; include the API prefix/version exactly once      |
| `email`, `password`                                                                               | Disposable developer account; set locally, password 12–128 characters and at most 512 UTF-8 bytes   |
| `accessToken`                                                                                     | Manually copied login/refresh access credential; local secret only                                  |
| `browserOrigin`                                                                                   | `http://localhost:5173`; change to an origin in backend `CORS_ORIGINS`                              |
| `organizationId`, `customerId`, `invoiceId`, `paymentId`, `categoryId`, `expenseId`, `exportId`   | Selected tenant/resources; captured from successful create/detail responses                         |
| `invitationId`, `membershipId`, `targetMembershipId`, `notificationId`                            | Explicitly selected invitation/member/recipient resource; never blindly choose the first list entry |
| `invitationToken`                                                                                 | Manually obtained invitation credential; local secret only                                          |
| `organizationVersion`, `customerVersion`, `invoiceVersion`, `membershipVersion`, `expenseVersion` | Current resource versions for required `If-Match` headers                                           |
| `paymentIdempotencyKey`, `reversalIdempotencyKey`, `exportIdempotencyKey`                         | Separate unpredictable keys for each reviewed intent, such as locally generated UUIDs               |
| `optInRequest`                                                                                    | One-shot authorization for one exact request name; normally empty                                   |
| `expectedStatus`, `expectedErrorCode`                                                             | Optional manual negative-test expectations; normally empty; clear immediately after that test       |

No refresh-cookie variable is needed: use Postman's cookie jar. Avoid other
variable scopes with these names. Capture uses environment scope and does not
update the committed template. When changing tenants, clear resource IDs and
versions; otherwise a resource from the previous tenant should receive 404.

## Mutation safety and manual sending

Every POST/PATCH/DELETE and the audited CSV GET download is labelled
`[MANUAL OPT-IN]`. Copy its complete name into local `optInRequest`, review its
URL/body/headers, then press **Send** once. The pre-request script clears this
variable before sending. A later send needs another explicit opt-in. A different
request consumes the opt-in without executing. Normal reads do not need opt-in.

Default collection runs skip all these protected actions. Clear `optInRequest`
before any run and select only intended read requests; do not run financial or
destructive workflows collection-wide. There is no general mutation-enable switch,
automatic authentication, refresh, polling, chaining, or retry. Reversal, issuance,
closure, ownership transfer, deletion, and void/archive commands need individual
review on disposable records. Logout and registration are gated too.

Use a Postman client that supports
[`pm.execution.skipRequest()`](https://learning.postman.com/docs/tests-and-scripts/write-scripts/postman-sandbox-reference/pm-execution/).
The script throws if this capability is missing; a script error is not a guarantee
that every older client stops HTTP transmission. Do not use this collection in
an unsupported runtime, and never bypass the scripts for collection runs.

IDs/versions are captured only from success responses of selected resource
requests. Lists never overwrite resource IDs. Payment/reversal responses do not
update `invoiceVersion`; read the invoice before another versioned operation.
For membership mutations, first list members, deliberately select a non-Owner
member and copy that row's ID/version. Ownership transfer returns
`previousOwner` and `currentOwner`; manually refresh both member versions and the
organization afterward. Do not target the Owner with ordinary member commands.

## Authenticate

1. Set local `email`/`password`. Opt in to Register (request 03) if needed: 201
   creates a global User only. Registration does not log in or create a tenant.
2. Opt in to Login (04): 200 returns `data.accessToken`, `tokenType: "Bearer"`,
   `expiresIn`, and `user`. Manually copy the access token into local `accessToken`.
3. Verify Me (08). Protected requests inherit bearer authentication from the
   collection. No role or tenant permissions are trusted from the token.
4. Login sets the configurable HttpOnly cookie (default `sme_refresh`) at
   `/api/v1/auth`, SameSite Lax; Secure in production. Keep the Postman cookie jar
   enabled and use the identical host/scheme for login, refresh, and logout.
   `localhost` and `127.0.0.1` are different cookie hosts. Postman does not refresh
   an expired access token for this collection automatically.
5. To refresh, opt in to request 05 with JSON `{}` and the jar's current cookie.
   It has **No Auth**, not bearer auth. Enable its Origin header with an allowed
   `browserOrigin` in production (or provide an allowed Referer when Origin is
   absent). Supplied invalid Origin never falls back to Referer. Successful refresh
   rotates the cookie and returns a new access token; copy that token manually.
   Never copy or reuse an older cookie: reuse can revoke the entire session family.
6. Login also rejects an invalid supplied Origin/Referer. All five auth POST
   routes require `Content-Type: application/json`; refresh/logout/logout-all
   use `{}`. Other media types return 415 `INVALID_REQUEST`.
7. Logout (06) accepts bearer or refresh cookie, clears the cookie, returns 204;
   absent credentials are a no-op. Logout All (07) requires bearer and returns 204.
   Cookie-origin protection applies to cookie logout. Clear local `accessToken`
   and credentials afterward. Access authentication rechecks current User/session.

## Exercise the business flows

Each numbered request refers to its prefix in the collection. Opt in separately
for every mutation; do not run these instructions as an unattended scenario.
Synthetic dates are fixed in October 2026. Adjust all related invoice/payment/
reversal/expense/report dates together if testing a different period. Disabled
query examples mean server defaults apply until you explicitly enable them.

1. **Organization:** Create (09) sends required `legalName`, `baseCurrency: "INR"`,
   `timezone: "Asia/Kolkata"`; 201 captures ID/version. It atomically creates default
   expense categories, invoice sequence, active Owner and audit evidence. Verify
   list/detail (10/11). Update (12) requires `If-Match: "{{organizationVersion}}"`.
   Currency locks after the first invoice or expense. Closure (13) is terminal.
2. **Customer:** Create (24), list/detail (25/26), then optional update (27) with
   current version. Archive (28) retains history; archived customers cannot be used
   as eligible new invoice customers. Required creation field is `displayName`;
   the synthetic example also uses a supported email.
3. **Invoice:** Create (29) sends customerId, issueDate, dueDate, taxRate, discount,
   and complete item objects. Quantity, price, rate and discount values are decimal
   strings. The example has one `1000.00` item, no tax or discount; the server
   calculates totals. Read (31) to get current version. Issue (34) sends `{}` with
   `If-Match: "{{invoiceVersion}}"`, returns 200 and assigns an immutable number/
   customer snapshot. Draft PATCH/DELETE (32/33) also require If-Match. Cancellation
   (35) requires no payment history, including reversals; void (36) permits reversed
   history but requires no active payment. Both require reason, no If-Match.
4. **Payment:** Generate a local unpredictable UUID into `paymentIdempotencyKey`.
   Record (37) sends `amount: "250.00"`, paymentDate, method BANK_TRANSFER; 201.
   Read invoice/payment (31/39) to inspect settlement. For a reviewed full reversal,
   generate a separate `reversalIdempotencyKey`, then Reverse (40) with reason and
   reversalDate; 200. Partial reversal and extra amount fields are unsupported.
   Same key/route/body replays the original receipt, with `Idempotency-Replayed:
true`; changed intent under the same key conflicts. Never generate a fresh key
   automatically after a timeout; inspect the receipt and retain the original key.
5. **Expense:** List categories (41), select an ACTIVE tenant category and copy its
   ID, or create a custom one (42) to capture `categoryId`. Create (45) sends the
   required categoryId, amount string, expenseDate, description; 201. Detail (47)
   refreshes its version. Update (48) and terminal Void (49) use the current
   `If-Match: "{{expenseVersion}}"`; void requires reason. Category update/archive
   (43/44) have no version header; system/archived restrictions still apply.
6. **Analytics:** Read Cash Flow (50), P&L (51), Summary (52), Aging (53). Enable
   fromDate/toDate for `2026-10-01` through `2026-10-31`; enable asOfDate where
   supported. Cash/P&L ranges are at most 366 inclusive days. Cash groupBy supports
   day/week/month; P&L none/month. Reversed payments and void expenses drop from
   current-state aggregates on their original dates. P&L is simplified cash basis,
   not a GAAP/IFRS statement. Aging returns five buckets, not an invoice list.
7. **Notifications:** List (54) is recipient-specific; an empty array is valid.
   With an eligible overdue invoice and configured running worker, the existing
   reminder process may create notifications. There is no public creation/trigger
   API and no guarantee of immediate delivery. Select your notification's ID,
   then explicitly Mark Read (55) or terminal Archive (56), each with `{}`. Both
   are idempotent. Reading an archived notification keeps it archived. See
   [notification implementation notes](../api-inventory.md) for worker behavior.
8. **Members/invitations:** Use 14–23 only with appropriate permissions. Invitations
   accept ADMIN/ACCOUNTANT/MEMBER/VIEWER, not OWNER. In development, create (15)
   returns `data.delivery.token`; manually place it in local `invitationToken`, log
   in as the invited email and Accept (18). Never log/export this credential.
   Production invitation email delivery is not implemented and returns no raw
   token. Transfer (23) requires authentication within 15 minutes; re-login first.
   Member PATCH/suspend/reactivate/remove require the selected member's version.

## Reports and authenticated CSV downloads

Preview invoices/payments/expenses/receivables with 57–60. Preview data is JSON;
CSV is returned only by the download route. Report filters differ from source
list filters: expense preview uses `expenseCategoryId` and `vendorPayee`, while
source expense listing uses `categoryId` and `vendor`.

| Export reportType      | Allowed parameters                               |
| ---------------------- | ------------------------------------------------ |
| INVOICE_REGISTER       | fromDate, toDate, asOfDate, customerId, status   |
| PAYMENT_REGISTER       | fromDate, toDate, invoiceId                      |
| EXPENSE_REGISTER       | fromDate, toDate, expenseCategoryId, vendorPayee |
| RECEIVABLES            | asOfDate                                         |
| CASH_FLOW              | fromDate, toDate, groupBy (day/week/month)       |
| CASH_BASIS_PERFORMANCE | fromDate, toDate, groupBy (none/month)           |

All parameters are optional; `parameters` itself is required. Preview routes also
accept limit/after. Do not put pagination, source sort fields, or unsupported
status filters into export parameters. Unknown fields are rejected.

Set a fresh local `exportIdempotencyKey` and opt in to Create Export (61).
The optional backend key is enabled in the example to protect that intent.
202 returns durable metadata, initially PENDING; it does not mean the file is ready.
Run the worker, then manually read export status (63), or history (62). Wait for
READY; PROCESSING, FAILED and EXPIRED are legitimate states. Inspect errorCode
and worker configuration if needed. Do not assume job completion or enqueue again
by repeating creation. The collection contains no polling loop.

After READY, opt in to Download (64), using bearer authentication and selected
organization/export IDs. Save the response bytes locally (Postman's response save
control). Assertions check 200, CSV media type, attachment, private/no-store and
line termination. Inspect the header row, expected synthetic records, Decimal
strings, date range, and escaped CSV cells; compare with the preview's current
state when unchanged. The INVOICE_REGISTER header is:

```text
id,invoiceNumber,status,customerId,customerName,issueDate,dueDate,currency,total,paid,balance,overdue
```

Authorization is rechecked on download; no public artifact URL exists. Test 401
with no token, 403 with an active member lacking report.export (e.g. MEMBER),
and concealed 404 with an unrelated tenant. Non-ready returns 409
EXPORT_NOT_READY, expired 410 EXPORT_EXPIRED, missing/unavailable artifact 503
EXPORT_ARTIFACT_UNAVAILABLE. Download writes audit evidence; report metadata reads
can mark expired records EXPIRED. Even some GETs have these documented side effects.

## Audit, pagination, and negative checks

Audit Logs (65) is read-only, tenant-scoped, permission `audit.read`. Select a
privileged account and inspect the evidence for the manual operations above.
Filters are exact actorUserId/action/entityType/entityId and inclusive local-date
occurredFrom/occurredTo (max 1825 days with both bounds). Credential/session/provider
internals are not returned. Global auth events without organization are excluded.

Enable optional query fields deliberately. Pagination uses limit 1–100 and the
returned `meta.nextCursor`. Copy the cursor into that request's `after` parameter;
preserve tenant/filter/sort, and stop when hasMore is false. Members, invitations,
and organization list return plain data arrays without cursor pagination.

Negative checks reuse an existing request; no duplicate endpoints are added.
Set local `expectedStatus` and, optionally, `expectedErrorCode` before a single
manual test. Restore the token, IDs, body/headers and clear both expectations
afterward. Every response still has an exact expected status, not a permissive
list that would turn unexpected denial into success.

| Check              | Safe setup and expectation                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Unauthorized       | Clear accessToken on Me (08): 401 UNAUTHENTICATED; cookie jar grants no bearer resource access                          |
| Forbidden          | Login as active VIEWER, list Members (14): 403 FORBIDDEN; viewers cannot read members                                   |
| Tenant isolation   | Select unrelated tenant ID or its customer ID with the current account: 404 RESOURCE_NOT_FOUND; compare to missing UUID |
| Validation         | Enable unknown query field on a read: 400; expect safe error envelope and restore query                                 |
| Stale version      | On disposable data, use an old If-Match: 409 CONCURRENT_MODIFICATION; gate the individual mutation                      |
| Financial bounds   | Overpayment: 422 PAYMENT_EXCEEDS_BALANCE; retain one intent/key and restore body                                        |
| Not ready download | Selected PENDING export, expectedStatus 409 and expectedErrorCode EXPORT_NOT_READY; gated download                      |

These are manual procedures, not claims that they were live-tested. Error checks
require code/message/requestId and reject secret/stack/SQL/constraint fields.
Business lifecycle rules can deny an otherwise permitted request. Unknown roles
fail closed; inactive/non-member scope is concealed as 404. Avoid negative tests
that mutate real data or deliberately replay refresh credentials.

## Maintain and verify

Only the five files in this directory are owned by this toolkit. Do not change
backend/frontend behavior to accommodate examples. From repository root:

```powershell
node.exe docs/postman/generate.mjs
```

From `backend/`, build current JavaScript before inspecting registered metadata:

```powershell
npm.cmd run build
npm.cmd run verify:api-inventory
```

From repository root, run offline validation against current built routes/DTOs:

```powershell
node.exe docs/postman/verify.mjs
# Optional full official Collection v2.1 JSON Schema check:
Invoke-WebRequest -Uri 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' -OutFile "$env:TEMP/sme-postman-collection-schema.json"
node.exe docs/postman/verify.mjs "$env:TEMP/sme-postman-collection-schema.json"
git diff --check
```

The verifier sends no HTTP requests. It checks exact route-set equality with
registered controllers and inventory, statuses, DTO bodies/query examples,
controller-required headers, one-shot gate behavior, embedded script syntax,
defined variables, empty credential placeholders, and absence of automatic
request/chaining or credential-capture scripts. With the schema argument it also
validates the complete collection using the backend's installed Ajv/draft-04.
It does not prove financial success or CSV correctness against a running backend.

Format toolkit files with the backend's installed Prettier and check the `.mjs`
files with its ESLint CLI. Backend format/lint/unit tests/build are independent
regression checks; do not run integration/E2E/queue suites against development
data. If Newman or Postman CLI is installed, run **only Health** against your
isolated local backend first, with optInRequest empty; never a destructive full
collection. Example (from repository root, if Newman is already installed):

```powershell
newman run docs/postman/SME-Fintech.postman_collection.json -e docs/postman/SME-Fintech.local.postman_environment.json --folder Health
```

Client availability and actual live results must be reported separately from
artifact checks. A generated collection does not mean all 65 routes passed.

## Contract limitations and differences found during inspection

- Idempotency is implemented only on payment create/reverse (required) and export
  create (optional); historical recommended headers on other mutations provide
  no replay guarantee and are omitted here.
- Organization closure has permission/lifecycle checks but no recent-auth check
  in its current controller/service, despite the planning authorization matrix.
  Ownership transfer does enforce the 15-minute recent-login window.
- Ownership transfer serializes `previousOwner` and `currentOwner`; its internal
  result uses a different name. Examples/assertions use the public serializer.
- Invitation acceptance conceals invalid, expired, used, or email-mismatched
  credentials with 410 INVITATION_INVALID_OR_EXPIRED, not a guessed 403/404.
- Production invitation delivery is unavailable. Notifications have no public
  creation or force-processing API. Exports require asynchronous worker progress.
- No OpenAPI document is assumed. Explicit examples must be reviewed when DTOs,
  serializers, permissions or domain rules change; regeneration is not contract
  discovery by itself. Existing planning documents are preserved, including
  any uncommitted edits.

## Verification record — 2026-10-13

| Command / check                                                                                                                                                                                                                                                                         | Outcome                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.exe docs/postman/generate.mjs` (root)                                                                                                                                                                                                                                             | 65 requests, 14 folders generated                                                                                                                                                                                                                                       |
| `node.exe docs/postman/verify.mjs "$env:TEMP/sme-postman-collection-schema.json"` (root)                                                                                                                                                                                                | PASS: official v2.1 schema, 65 unique requests matching registered controllers and inventory, success statuses, permission descriptions, 34 DTO bodies, 42 query examples, required headers, 37 one-shot gates, script syntax and placeholder/credential-capture checks |
| `node.exe backend/node_modules/prettier/bin/prettier.cjs --config backend/.prettierrc --check docs/postman/README.md docs/postman/generate.mjs docs/postman/verify.mjs docs/postman/SME-Fintech.postman_collection.json docs/postman/SME-Fintech.local.postman_environment.json` (root) | PASS                                                                                                                                                                                                                                                                    |
| `Get-Content ../docs/postman/generate.mjs -Raw \| node.exe node_modules/eslint/bin/eslint.js --stdin --stdin-filename scripts/postman-generate.mjs` (backend)                                                                                                                           | PASS                                                                                                                                                                                                                                                                    |
| `Get-Content ../docs/postman/verify.mjs -Raw \| node.exe node_modules/eslint/bin/eslint.js --stdin --stdin-filename scripts/postman-verify.mjs` (backend)                                                                                                                               | PASS                                                                                                                                                                                                                                                                    |
| `npm.cmd run format:check` (backend)                                                                                                                                                                                                                                                    | PASS                                                                                                                                                                                                                                                                    |
| `npm.cmd run lint` (backend)                                                                                                                                                                                                                                                            | PASS                                                                                                                                                                                                                                                                    |
| `npm.cmd run test` (backend)                                                                                                                                                                                                                                                            | PASS: 48 suites, 308 tests                                                                                                                                                                                                                                              |
| `npm.cmd run build` (backend)                                                                                                                                                                                                                                                           | PASS: 223 JavaScript files compiled                                                                                                                                                                                                                                     |
| `npm.cmd run verify:api-inventory` (backend, after build)                                                                                                                                                                                                                               | PASS: 65 implemented and 65 documented routes                                                                                                                                                                                                                           |
| `git diff --check` (root)                                                                                                                                                                                                                                                               | PASS                                                                                                                                                                                                                                                                    |
| `Get-Command newman,postman -ErrorAction SilentlyContinue`                                                                                                                                                                                                                              | Neither CLI installed; no live Postman/Newman execution performed                                                                                                                                                                                                       |
| `git status --short`                                                                                                                                                                                                                                                                    | Only task addition: `?? docs/postman/`; existing modified/untracked frontend and documentation work preserved; no commit                                                                                                                                                |

The direct ESLint file invocation ignored files outside its backend base path;
the successful stdin checks above apply the existing backend rules without adding
configuration. No database integration/E2E/queue suites or financial HTTP commands
were executed for this documentation-only change. No architecture, business logic,
Prisma schema, migrations, API contracts, worker or frontend files were changed.
