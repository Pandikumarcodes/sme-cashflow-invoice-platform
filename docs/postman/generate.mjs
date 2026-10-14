// Contract examples are deliberately explicit. Review controllers/DTOs before changing them.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const here = new URL('./', import.meta.url);
const require = createRequire(new URL('../../backend/package.json', here));
const prettier = require('prettier');
const inventory = await readFile(new URL('../api-inventory.md', here), 'utf8');
const routes = inventory
  .split('\n')
  .filter((line) => /^\|\s*\d+\s*\|/.test(line))
  .map((line) => {
    const c = line.split('|').map((value) => value.trim());
    return {
      n: Number(c[1]),
      method: c[2],
      path: c[3].replaceAll('`', ''),
      auth: c[5],
      permission: c[6].replaceAll('`', ''),
      purpose: c[7],
    };
  });
if (routes.length !== 65) throw new Error('Review route baseline before regenerating.');
const folders = [
  ['Health', 1, 2],
  ['Authentication', 3, 8],
  ['Organizations', 9, 13],
  ['Memberships and Invitations', 14, 23],
  ['Customers', 24, 28],
  ['Invoices', 29, 36],
  ['Payments and Reversals', 37, 40],
  ['Expense Categories', 41, 44],
  ['Expenses', 45, 49],
  ['Cash Flow and Profit & Loss', 50, 52],
  ['Receivables Aging', 53, 53],
  ['Notifications', 54, 56],
  ['Reports and CSV Exports', 57, 64],
  ['Audit Logs', 65, 65],
];
const invoice = {
  customerId: '{{customerId}}',
  issueDate: '2026-10-01',
  dueDate: '2026-10-31',
  taxRate: '0',
  discount: { type: 'NONE', value: '0' },
  items: [
    {
      description: 'October bookkeeping services',
      quantity: '1',
      unitPrice: '1000.00',
      sortOrder: 0,
    },
  ],
};
const bodies = {
  3: {
    email: '{{email}}',
    password: '{{password}}',
    firstName: 'Asha',
    lastName: 'Demo',
  },
  4: { email: '{{email}}', password: '{{password}}' },
  5: {},
  6: {},
  7: {},
  9: {
    legalName: 'Example Bookkeeping Private Limited',
    baseCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  },
  12: { displayName: 'Example Bookkeeping' },
  13: { reason: 'Disposable test organization closure' },
  15: { email: 'invited.developer@example.com', role: 'VIEWER' },
  18: { token: '{{invitationToken}}' },
  19: { role: 'MEMBER' },
  20: {},
  21: {},
  23: { targetMembershipId: '{{targetMembershipId}}' },
  24: { displayName: 'Example Office Supplies', email: 'billing@example.com' },
  27: { displayName: 'Example Office Supplies Updated' },
  28: {},
  29: invoice,
  32: { dueDate: '2026-11-15' },
  33: {},
  34: {},
  35: { reason: 'Test invoice issued in error' },
  36: { reason: 'Test invoice withdrawn' },
  37: { amount: '250.00', paymentDate: '2026-10-02', method: 'BANK_TRANSFER' },
  40: { reason: 'Duplicate test receipt', reversalDate: '2026-10-03' },
  42: { name: 'Demo software subscriptions' },
  43: { name: 'Demo software services' },
  44: {},
  45: {
    categoryId: '{{categoryId}}',
    amount: '125.00',
    expenseDate: '2026-10-02',
    description: 'Demo software subscription',
  },
  48: { description: 'Corrected demo subscription description' },
  49: { reason: 'Duplicate test expense' },
  55: {},
  56: {},
  61: {
    reportType: 'INVOICE_REGISTER',
    format: 'CSV',
    parameters: {
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      asOfDate: '2026-10-31',
    },
  },
};
const statuses = {
  3: 201,
  4: 200,
  5: 200,
  6: 204,
  7: 204,
  9: 201,
  13: 200,
  15: 201,
  17: 204,
  18: 200,
  20: 200,
  21: 200,
  22: 204,
  23: 200,
  24: 201,
  28: 200,
  29: 201,
  33: 204,
  34: 200,
  35: 200,
  36: 200,
  37: 201,
  40: 200,
  42: 201,
  44: 200,
  45: 201,
  49: 200,
  55: 200,
  56: 200,
  61: 202,
};
const versions = {
  12: 'organizationVersion',
  19: 'membershipVersion',
  20: 'membershipVersion',
  21: 'membershipVersion',
  22: 'membershipVersion',
  27: 'customerVersion',
  32: 'invoiceVersion',
  33: 'invoiceVersion',
  34: 'invoiceVersion',
  48: 'expenseVersion',
  49: 'expenseVersion',
};
const keys = {
  37: 'paymentIdempotencyKey',
  40: 'reversalIdempotencyKey',
  61: 'exportIdempotencyKey',
};
const captures = {
  9: ['organizationId', 'organizationVersion'],
  11: ['organizationId', 'organizationVersion'],
  12: ['organizationId', 'organizationVersion'],
  15: ['invitationId'],
  18: ['membershipId', 'membershipVersion'],
  19: ['membershipId', 'membershipVersion'],
  20: ['membershipId', 'membershipVersion'],
  21: ['membershipId', 'membershipVersion'],
  24: ['customerId', 'customerVersion'],
  26: ['customerId', 'customerVersion'],
  27: ['customerId', 'customerVersion'],
  28: ['customerId', 'customerVersion'],
  29: ['invoiceId', 'invoiceVersion'],
  31: ['invoiceId', 'invoiceVersion'],
  32: ['invoiceId', 'invoiceVersion'],
  34: ['invoiceId', 'invoiceVersion'],
  35: ['invoiceId', 'invoiceVersion'],
  36: ['invoiceId', 'invoiceVersion'],
  37: ['paymentId'],
  39: ['paymentId'],
  40: ['paymentId'],
  42: ['categoryId'],
  43: ['categoryId'],
  44: ['categoryId'],
  45: ['expenseId', 'expenseVersion'],
  47: ['expenseId', 'expenseVersion'],
  48: ['expenseId', 'expenseVersion'],
  49: ['expenseId', 'expenseVersion'],
  55: ['notificationId'],
  56: ['notificationId'],
  61: ['exportId'],
  63: ['exportId'],
};
const page = ['limit', 'after'];
const sort = ['sortBy', 'sortOrder'];
const range = ['fromDate', 'toDate'];
const query = {
  14: ['role', 'status'],
  16: ['status'],
  25: [...page, 'status', 'search', ...sort],
  30: [
    ...page,
    'status',
    'paymentState',
    'overdue',
    'customerId',
    'search',
    'issueDateFrom',
    'issueDateTo',
    'dueDateFrom',
    'dueDateTo',
    ...sort,
  ],
  38: [...page, 'invoiceId', 'status', 'method', 'paymentDateFrom', 'paymentDateTo', ...sort],
  41: [...page, 'status'],
  46: [...page, 'status', 'categoryId', 'expenseDateFrom', 'expenseDateTo', 'vendor', ...sort],
  50: [...range, 'groupBy'],
  51: [...range, 'groupBy'],
  52: [...range, 'asOfDate'],
  53: ['asOfDate'],
  54: [...page, 'status', ...sort],
  57: [...page, ...range, 'asOfDate', 'customerId', 'status'],
  58: [...page, ...range, 'invoiceId'],
  59: [...page, ...range, 'expenseCategoryId', 'vendorPayee'],
  60: [...page, 'asOfDate'],
  62: [...page, 'status', 'reportType'],
  65: [
    ...page,
    ...sort,
    'actorUserId',
    'action',
    'entityType',
    'entityId',
    'occurredFrom',
    'occurredTo',
  ],
};
const queryExample = (field, n) => {
  if (field === 'limit') return '25';
  if (field === 'after') return '';
  if (field.endsWith('Id'))
    return ['organizationId', 'customerId', 'invoiceId', 'categoryId'].includes(field)
      ? `{{${field}}}`
      : '';
  if (field === 'groupBy') return 'month';
  if (field === 'sortOrder') return 'asc';
  if (field === 'sortBy')
    return {
      25: 'displayName',
      30: 'issueDate',
      38: 'paymentDate',
      46: 'expenseDate',
      54: 'createdAt',
      65: 'occurredAt',
    }[n];
  if (field === 'asOfDate' || field.endsWith('To') || field === 'toDate') return '2026-10-31';
  if (field.endsWith('From') || field === 'fromDate') return '2026-10-01';
  return '';
};
const notes = {
  1: 'Public process liveness; no dependencies checked.',
  2: '200 when PostgreSQL and Redis are ready; 503 when unavailable.',
  3: 'Creates a global user only; no token or organization. Password: 12–128 characters, at most 512 UTF-8 bytes. Duplicate email: 409 EMAIL_UNAVAILABLE. Rate limited: 429.',
  4: 'Returns data.accessToken, tokenType, expiresIn, user; sets HttpOnly refresh cookie. Manually copy the token into a local secret variable. Invalid credentials: 401 INVALID_CREDENTIALS; 429 rate limit. Supplied Origin/Referer must be allowed.',
  5: 'JSON {}. No bearer auth; sends current refresh cookie from Postman cookie jar. Rotates it once. Returns data.accessToken, tokenType, expiresIn; no user. Never reuse an old cookie: 401 SESSION_COMPROMISED revokes its family. In production supply an allowed Origin or Referer.',
  6: 'JSON {}. Bearer or refresh-cookie logout; absent credentials are a no-op. 204 clears cookie. Cookie-origin protection applies. Manually clear accessToken after logout.',
  7: 'JSON {}. Revokes all sessions; manually clear accessToken afterward.',
  9: 'Atomic organization, invoice sequence, default categories, active Owner, audit creation. INR and Asia/Kolkata are supported. No implemented idempotency handling. Invalid currency/timezone: 422; slug conflict: 409.',
  12: 'Current version required; stale: 409 CONCURRENT_MODIFICATION. Base currency locks after first invoice/expense. Invalid currency/timezone: 422; locked currency: 409.',
  13: 'TERMINAL: organization.close permission (Owner); retains history and makes tenant unavailable. No If-Match, recent-auth check, or implemented idempotency in this controller/service. 403 permission denial; 409 concurrent modification.',
  15: 'Roles ADMIN, ACCOUNTANT, MEMBER, VIEWER; optional expiresInDays integer 1–30. Pending duplicate: 409. Development returns data.delivery.token; manually handle as a secret. Production delivery is unavailable; no production token is returned.',
  17: 'Revoke pending invitation, retain history; no request body or If-Match.',
  18: 'Token must be 43 base64url characters. Login as the invited email. Token is single-use, email-bound, time-limited. Do not capture it in scripts. 410 INVITATION_INVALID_OR_EXPIRED for invalid/expired/used token or email mismatch; 409 existing membership.',
  19: 'Only non-Owner targets and assignable roles ADMIN, ACCOUNTANT, MEMBER, VIEWER. Owner safeguards apply; lifecycle/owner conflict: 409.',
  20: 'Current non-Owner membership only; 409 invalid lifecycle/owner operation.',
  21: 'Retained non-Owner suspended or removed membership; 409 invalid lifecycle/owner operation.',
  22: 'Retains row as REMOVED. Owner safeguards apply. No body.',
  23: 'Owner/recent login within 15 minutes required (401 REAUTHENTICATION_REQUIRED if stale). Target must be ACTIVE. Returns data.previousOwner and data.currentOwner. No If-Match or implemented idempotency. Refresh organization and member versions afterward.',
  24: 'Required displayName; optional nullable customerCode (max 50) and email (max 320). Duplicate customerCode: 409.',
  27: 'Allowlisted partial update; customerCode/email may be null. Stale version: 409.',
  28: 'Archives with retained history; idempotent. No If-Match.',
  29: 'Creates DRAFT; active tenant customer required. All fields in example required. Decimal strings only: quantity up to 6 places, unitPrice up to 4, taxRate up to 6; discount NONE/FIXED/PERCENTAGE. 1–1000 items with integer sortOrder. Totals/currency/status are server-owned. Invalid financial values/dates: 422; inactive customer: 409.',
  32: 'DRAFT only; partial update with current version. If supplying items, replace with the full writable item list without returned IDs. Stale/finalized state: 409.',
  33: 'Deletes DRAFT only; JSON {} and current version. Issued documents cannot be deleted: 409.',
  34: 'IRREVERSIBLE numbering and issued snapshot; JSON {}, current invoice version, eligible active customer, valid draft. 409 invalid/finalized state or stale version. No implemented idempotency.',
  35: 'ISSUED only and no payment history, even reversed payments. Required reason. No If-Match. 409 INVALID_INVOICE_STATE.',
  36: 'ISSUED only, no active payments. Required reason; reversed history permitted. No If-Match. 409 ACTIVE_PAYMENTS_EXIST/INVALID_INVOICE_STATE.',
  37: 'Positive currency-minor-unit Decimal string; method CASH/BANK_TRANSFER/UPI/CHEQUE/CARD_EXTERNAL/OTHER. ISSUED invoice; amount within balance. 422 INVALID_PAYMENT_AMOUNT/PAYMENT_EXCEEDS_BALANCE/INVALID_PAYMENT_DATE; 409 state/idempotency conflict. Required key, no If-Match. Same key/body replay retains 201.',
  40: 'IRREVERSIBLE full reversal once; reason and reversalDate only, no amount. Required key, no If-Match. 409 PAYMENT_ALREADY_REVERSED/IDEMPOTENCY_CONFLICT. Same key/body replays 200.',
  42: 'Required name; optional description (max 500). Name normalization/uniqueness enforced; 409 EXPENSE_CATEGORY_ALREADY_EXISTS.',
  43: 'Partial category update; no If-Match. System/archived category restrictions: 409 EXPENSE_CATEGORY_NOT_EDITABLE.',
  44: 'Archive retained category; no If-Match. System category restriction: 409.',
  45: 'Paid expense only; required categoryId, amount, expenseDate, description. Optional nullable vendorPayee, reference, notes. Category must be active and tenant-owned. 422 invalid amount/date; 409 inactive category. No implemented idempotency.',
  48: 'ACTIVE only; partial writable update, current version. 409 EXPENSE_NOT_EDITABLE/CONCURRENT_MODIFICATION.',
  49: 'TERMINAL VOID; reason and current version. 409 EXPENSE_ALREADY_VOIDED/CONCURRENT_MODIFICATION.',
  50: 'Optional inclusive fromDate/toDate (max 366 days), groupBy day/week/month. Defaults current organization-local month. Derived current RECORDED payment inflows and ACTIVE expense outflows; reversals excluded from original dates, not a new negative movement.',
  51: 'Optional inclusive range max 366 days; groupBy none/month. Simplified cash basis, not GAAP/IFRS; reconciliation shares cash-flow calculations.',
  52: 'Optional fromDate/toDate/asOfDate; asOfDate cannot precede fromDate. Billing issue-date cohort, cash payment/expense-date range, receivables through as-of. All authoritative amounts are strings.',
  53: 'Optional asOfDate defaults organization-local today. Five buckets CURRENT, 1_30, 31_60, 61_90, 91_PLUS; source-derived positive outstanding balances.',
  54: 'Own recipient inbox only; status UNREAD/READ/ARCHIVED, sortBy createdAt, sortOrder asc/desc. No API to create notifications. Empty inbox is valid.',
  55: 'JSON {}; idempotent own-recipient read. An archived notification stays archived. Another recipient or tenant: 404.',
  56: 'TERMINAL own-recipient archive; JSON {}; idempotent. Another recipient or tenant: 404.',
  57: 'Invoice register JSON preview; status DRAFT/ISSUED/CANCELLED/VOID; optional customerId, inclusive fromDate/toDate and asOfDate.',
  58: 'Recorded payment JSON preview; optional invoiceId and inclusive fromDate/toDate.',
  59: 'Active expense JSON preview. Filters use expenseCategoryId and vendorPayee (different from /expenses query names).',
  60: 'Canonical five aging bucket preview; optional asOfDate. Rows identify bucket rather than resource UUID.',
  61: '202 durable asynchronous export, never immediate CSV. Required reportType, format CSV, parameters object. Optional implemented Idempotency-Key prevents duplicate export intent; same-key changed parameters: 409. Six types INVOICE_REGISTER, PAYMENT_REGISTER, EXPENSE_REGISTER, RECEIVABLES, CASH_FLOW, CASH_BASIS_PERFORMANCE. Parameters exactly match corresponding preview/analytics contracts; no invented sort/status parameters.',
  62: 'Export history: optional reportType and status PENDING/PROCESSING/READY/FAILED/EXPIRED; cursor pagination. Reads can mark expired READY records EXPIRED.',
  63: 'Returns safe metadata only; status is not guaranteed READY. No automatic polling. Reads can mark expired READY records EXPIRED.',
  64: 'MANUAL OPT-IN even though GET: audited download. Send only after READY. 200 original CSV bytes, text/csv; charset=utf-8, attachment, Cache-Control private,no-store. 409 EXPORT_NOT_READY; 410 EXPORT_EXPIRED; 503 EXPORT_ARTIFACT_UNAVAILABLE; 401/403/404 authorization. No public download URL.',
  65: 'Immutable safe projected tenant history. Optional exact actorUserId/action/entityType/entityId, inclusive occurredFrom/occurredTo dates; max range 1825 days when both bounds supplied; sortBy occurredAt, sortOrder asc/desc. Unknown action/entityType gives empty results. Auth events with no organization are not included.',
};
const listIds = new Set([10, 14, 16, 25, 30, 38, 41, 46, 54, 57, 58, 59, 60, 62, 65]);
const pagedIds = new Set([25, 30, 38, 41, 46, 54, 57, 58, 59, 60, 62, 65]);
const resourceIds = new Set(Object.keys(captures).map(Number));
const basicFields = {
  8: ['id', 'email', 'firstName', 'lastName', 'status'],
  23: ['previousOwner', 'currentOwner'],
  50: ['inflows', 'outflows', 'netCashFlow', 'series'],
  51: ['revenue', 'expenses', 'netResult', 'expenseByCategory'],
  52: ['billing', 'collections', 'receivables', 'spending', 'cash', 'customers'],
  53: ['outstanding', 'overdue', 'buckets'],
};
const variables = {
  baseUrl: 'http://localhost:3000/api/v1',
  accessToken: '',
  email: '',
  password: '',
  organizationId: '',
  customerId: '',
  invoiceId: '',
  paymentId: '',
  categoryId: '',
  expenseId: '',
  exportId: '',
  invitationId: '',
  invitationToken: '',
  membershipId: '',
  targetMembershipId: '',
  notificationId: '',
  organizationVersion: '',
  customerVersion: '',
  invoiceVersion: '',
  membershipVersion: '',
  expenseVersion: '',
  paymentIdempotencyKey: '',
  reversalIdempotencyKey: '',
  exportIdempotencyKey: '',
  browserOrigin: 'http://localhost:5173',
  optInRequest: '',
  expectedStatus: '',
  expectedErrorCode: '',
};
const script = (listen, text) => ({
  listen,
  script: { type: 'text/javascript', exec: text.trim().split('\n') },
});
function makeRequest(route) {
  const { n, method, path } = route;
  const protectedAction = method !== 'GET' || n === 64;
  const name = `${String(n).padStart(2, '0')} ${protectedAction ? '[MANUAL OPT-IN] ' : ''}${method} ${path.replace('/api/v1', '')}`;
  const url = '{{baseUrl}}' + path.slice('/api/v1'.length).replace(/:(\w+)/g, '{{$1}}');
  const params = (query[n] ?? []).map((key) => ({
    key,
    value: queryExample(key, n),
    disabled: true,
    description: 'Optional. Enable with a valid value; keep cursor filters and sort unchanged.',
  }));
  const headers = [{ key: 'Accept', value: n === 64 ? 'text/csv' : 'application/json' }];
  if (bodies[n] !== undefined) headers.push({ key: 'Content-Type', value: 'application/json' });
  if (versions[n])
    headers.push({
      key: 'If-Match',
      value: `"{{${versions[n]}}}"`,
      description: 'Required current version; refresh the selected resource before changing it.',
    });
  if (keys[n])
    headers.push({
      key: 'Idempotency-Key',
      value: `{{${keys[n]}}}`,
      description:
        n === 61
          ? 'Optional on backend; enabled here for safer manual creation.'
          : 'Required. One unpredictable key per intent; retain for identical retry.',
    });
  if ([4, 5, 6].includes(n))
    headers.push({
      key: 'Origin',
      value: '{{browserOrigin}}',
      disabled: true,
      description:
        'Enable with a configured allowed origin; required for production cookie refresh/logout.',
    });
  const success = statuses[n] ?? 200;
  const desc = [
    route.purpose,
    `Authentication: ${route.auth}. Permission: ${route.permission}.`,
    `Path parameters: ${(path.match(/:(\w+)/g) ?? []).join(', ') || 'none'}; UUID resource parameters must refer to the selected tenant.`,
    `Query allowlist: ${(query[n] ?? []).join(', ') || 'none'}. Optional query examples are disabled.`,
    `Success: ${success}${success === 204 ? ' with no body' : n <= 2 ? ' { status: "ok" }' : n === 64 ? ' CSV bytes' : listIds.has(n) ? ' { data: [...] }' + (pagedIds.has(n) ? ' with meta.limit/hasMore/nextCursor' : '') : ' { data: object }'}.`,
    `If-Match: ${versions[n] ? 'required, quoted positive resource version' : 'not required'}. Idempotency-Key: ${keys[n] ? (n === 61 ? 'optional, supported' : 'required') : 'not implemented on this route'}.`,
    notes[n] ?? '',
    n > 2
      ? 'Errors use { error: { code, message, requestId, fields? or details? } }. Invalid/unknown input: 400; protected routes: 401 invalid credentials, 404 concealed inactive/non-member/cross-tenant scope, 403 active member lacking permission where applicable; domain rules still apply. See linked inventory/contracts and route-specific notes.'
      : '',
    pagedIds.has(n)
      ? 'Pagination: limit 1–100, after opaque returned meta.nextCursor; never fabricate or reuse across tenant/filter/sort. Reset after when filters change.'
      : '',
    protectedAction
      ? `Send manually only: set local optInRequest to this exact request name, then press Send. It is cleared before sending: ${name}`
      : '',
    'Sources: docs/api-inventory.md; docs/api-contracts.md; backend/src/modules controllers, DTOs, response mappers; backend/test/*e2e-spec.js.',
  ]
    .filter(Boolean)
    .join('\n\n');
  const request = {
    method,
    header: headers,
    url: {
      raw: url,
      host: ['{{baseUrl}}'],
      path: path
        .slice('/api/v1/'.length)
        .replace(/:(\w+)/g, '{{$1}}')
        .split('/'),
      ...(params.length ? { query: params } : {}),
    },
    description: desc,
  };
  if ([1, 2, 3, 4, 5].includes(n)) request.auth = { type: 'noauth' };
  if (bodies[n] !== undefined)
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(bodies[n], null, 2),
      options: { raw: { language: 'json' } },
    };
  const pre = protectedAction
    ? `
if (typeof pm.execution?.skipRequest !== 'function') throw new Error('This client cannot enforce the mutation gate. Use supported Postman; do not run this collection.');
const enabled = pm.environment.get('optInRequest') === pm.info.requestName;
pm.environment.unset('optInRequest');
if (!enabled) pm.execution.skipRequest();
`
    : '';
  // IDs/versions are captured only after a validated success, never from list[0]. Credentials stay manual.
  const test = `
const successStatus = ${success};
const override = pm.environment.get('expectedStatus');
const expected = override ? Number(override) : successStatus;
pm.test('Expected HTTP status', () => pm.expect(pm.response.code).to.eql(expected));
if (pm.response.code >= 400) {
  const body = pm.response.json();
  pm.test('Safe canonical error envelope', () => {
    pm.expect(body).to.have.property('error');
    for (const key of ['code', 'message', 'requestId']) pm.expect(body.error[key]).to.be.a('string').and.not.empty;
    const inspect = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        pm.expect(['stack','sql','constraint','password','passwordHash','tokenHash','refreshToken','authorization','cookie'].includes(key)).to.eql(false);
        inspect(child);
      }
    };
    inspect(body);
  });
  const code = pm.environment.get('expectedErrorCode');
  if (code) pm.test('Expected error code', () => pm.expect(body.error.code).to.eql(code));
  if (expected === 401) pm.test('Unauthorized response', () => pm.expect(['UNAUTHENTICATED','INVALID_CREDENTIALS','INVALID_SESSION','SESSION_COMPROMISED','REAUTHENTICATION_REQUIRED']).to.include(body.error.code));
  if (expected === 403) pm.test('Forbidden response', () => pm.expect(body.error.code).to.eql('FORBIDDEN'));
} else if (pm.response.code === successStatus && expected === successStatus) {
  ${
    success === 204
      ? "pm.test('No response body', () => pm.expect(pm.response.text()).to.eql(''));"
      : n === 64
        ? `pm.test('Private CSV attachment', () => {
    pm.expect(pm.response.headers.get('Content-Type')).to.match(/^text\\/csv;\\s*charset=utf-8/i);
    pm.expect(pm.response.headers.get('Content-Disposition')).to.match(/^attachment;/i);
    pm.expect(pm.response.headers.get('Cache-Control')).to.match(/private/);
    pm.expect(pm.response.headers.get('Cache-Control')).to.match(/no-store/);
    pm.expect(pm.response.text()).to.match(/\\r?\\n/);
  });`
        : n <= 2
          ? "pm.test('Health response', () => pm.expect(pm.response.json()).to.eql({status:'ok'}));"
          : `const body = pm.response.json();
  let validStructure = false;
  pm.test('Success structure', () => {
    pm.expect(body).to.have.property('data');
    ${captures[n]?.[1] ? 'pm.expect(Number.isSafeInteger(body.data.version) && body.data.version > 0).to.eql(true);' : ''}
    ${listIds.has(n) ? "pm.expect(body.data).to.be.an('array');" : "pm.expect(body.data).to.be.an('object');"}
    ${pagedIds.has(n) ? "pm.expect(body.meta.hasMore).to.be.a('boolean'); pm.expect(body.meta.limit).to.be.a('number'); pm.expect(body.meta).to.have.property('nextCursor');" : ''}
    ${resourceIds.has(n) || n === 3 || n === 8 ? 'pm.expect(body.data.id).to.match(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);' : ''}
    ${listIds.has(n) && ![60].includes(n) ? "for (const row of body.data) pm.expect(row.id).to.be.a('string').and.not.empty;" : ''}
    ${[4, 5].includes(n) ? "pm.expect(body.data.accessToken).to.be.a('string').and.not.empty; pm.expect(body.data.tokenType).to.eql('Bearer'); pm.expect(body.data.expiresIn).to.be.a('number');" : ''}
    ${(basicFields[n] ?? []).map((field) => `pm.expect(body.data).to.have.property('${field}');`).join('\n    ')}
    ${[29, 31, 32, 34, 35, 36].includes(n) ? "for (const field of ['subtotal','total','amountPaid','balanceDue']) pm.expect(body.data[field]).to.be.a('string');" : ''}
    ${[37, 39, 40, 45, 47, 48, 49].includes(n) ? "pm.expect(body.data.amount).to.be.a('string');" : ''}
    ${[61, 63].includes(n) ? "pm.expect(['PENDING','PROCESSING','READY','FAILED','EXPIRED']).to.include(body.data.status); pm.expect(body.data.format).to.eql('CSV');" : ''}
    validStructure = true;
  });
  ${
    captures[n]
      ? `if (validStructure) {
    pm.environment.set('${captures[n][0]}', body.data.id);
    ${captures[n][1] ? `if (Number.isSafeInteger(body.data.version) && body.data.version > 0) pm.environment.set('${captures[n][1]}', String(body.data.version));` : ''}
  }`
      : ''
  }`
  }
}
`;
  return {
    name,
    request,
    event: [...(pre ? [script('prerequest', pre)] : []), script('test', test)],
    response: [],
  };
}
const collection = {
  info: {
    name: 'SME Fintech — 65 API Testing Toolkit',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    description:
      'Exactly 65 registered routes. Manual developer toolkit, not an executable financial scenario. All mutations and audited downloads require one-shot local optInRequest; default collection runs skip them. Clear optInRequest before any run. No automatic login, refresh, retries, polling, or secret capture. See README.md.',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  },
  item: folders.map(([name, start, end]) => ({
    name,
    item: routes.filter((r) => r.n >= start && r.n <= end).map(makeRequest),
  })),
};
const secrets = new Set(['accessToken', 'password', 'invitationToken']);
const environment = {
  name: 'SME Fintech local — placeholders only',
  values: Object.entries(variables).map(([key, value]) => ({
    key,
    value,
    type: secrets.has(key) ? 'secret' : 'default',
    enabled: true,
  })),
  _postman_variable_scope: 'environment',
};
await writeFile(
  new URL('SME-Fintech.postman_collection.json', here),
  await prettier.format(JSON.stringify(collection), { parser: 'json', printWidth: 100 }),
);
await writeFile(
  new URL('SME-Fintech.local.postman_environment.json', here),
  await prettier.format(JSON.stringify(environment), { parser: 'json', printWidth: 100 }),
);
console.log(
  `Generated ${routes.length} requests in ${folders.length} folders; no live requests sent.`,
);
