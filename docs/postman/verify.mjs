// Offline verification only: never starts an application or sends an HTTP request.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';

const here = new URL('./', import.meta.url);
const require = createRequire(new URL('../../backend/package.json', here));
require('reflect-metadata');
await import('../../backend/test/setup-env.js');
const { RequestMethod } = require('@nestjs/common');
const { validateSync } = require('class-validator');
const { plainToInstance } = require('class-transformer');
const { reportOptions, parse, REQUEST_SCHEMA } =
  await import('../../backend/dist/modules/reports/domain/report.js');
const { AppModule } = await import('../../backend/dist/app.module.js');
const collection = JSON.parse(
  await readFile(new URL('SME-Fintech.postman_collection.json', here), 'utf8'),
);
const environment = JSON.parse(
  await readFile(new URL('SME-Fintech.local.postman_environment.json', here), 'utf8'),
);
const inventory = await readFile(new URL('../api-inventory.md', here), 'utf8');
const documented = inventory
  .split('\n')
  .filter((l) => /^\|\s*\d+\s*\|/.test(l))
  .map((l) => {
    const c = l.split('|').map((v) => v.trim());
    return c[2] + ' ' + c[3].replaceAll('`', '');
  });
const modules = new Set(),
  controllers = new Set();
async function visit(value) {
  const module = await value,
    type = module?.module ?? module;
  if (!type || modules.has(type)) return;
  modules.add(type);
  for (const c of [
    ...(Reflect.getMetadata('controllers', type) ?? []),
    ...(module.controllers ?? []),
  ])
    controllers.add(c);
  for (const child of [...(Reflect.getMetadata('imports', type) ?? []), ...(module.imports ?? [])])
    await visit(child);
}
await visit(AppModule);
const actual = new Map();
for (const c of controllers)
  for (const name of Object.getOwnPropertyNames(c.prototype)) {
    const fn = c.prototype[name],
      method = Reflect.getMetadata('method', fn);
    if (method === undefined) continue;
    const path = (
      '/api/v1/' +
      Reflect.getMetadata('path', c) +
      '/' +
      (Reflect.getMetadata('path', fn) ?? '')
    )
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');
    const key = RequestMethod[method] + ' ' + path;
    assert(!actual.has(key), 'Duplicate controller route');
    actual.set(key, { c, name, fn, method });
  }
const requests = collection.item.flatMap((folder) => folder.item);
const vars = new Map(environment.values.map((v) => [v.key, v.value]));
const sample = (key) => {
  if (key === 'password') return 'synthetic-test-password';
  if (key === 'email') return 'developer@example.com';
  if (key === 'invitationToken') return 'a'.repeat(43);
  if (key.endsWith('Id')) return '11111111-1111-4111-8111-111111111111';
  if (key.endsWith('Version')) return '1';
  return vars.get(key);
};
const generated = [];
let bodyChecks = 0,
  queryChecks = 0,
  gates = 0;
for (const item of requests) {
  const r = item.request;
  const path = r.url.raw.replace('{{baseUrl}}', '/api/v1').replace(/\{\{(\w+)\}\}/g, ':$1');
  const key = r.method + ' ' + path;
  generated.push(key);
  const route = actual.get(key);
  assert(route, `Invented route: ${key}`);
  for (const permission of Reflect.getMetadata('authorization:required-permissions', route.fn) ??
    []) {
    assert(r.description.includes(permission), `Missing permission: ${key} ${permission}`);
  }
  const status = Reflect.getMetadata('__httpCode__', route.fn) ?? (r.method === 'POST' ? 201 : 200);
  const test = item.event.find((e) => e.listen === 'test').script.exec.join('\n');
  assert(test.includes(`const successStatus = ${status};`), `Wrong success status: ${key}`);
  const types = Reflect.getMetadata('design:paramtypes', route.c.prototype, route.name) ?? [];
  const args = Reflect.getMetadata('__routeArguments__', route.c, route.name) ?? {};
  if (path.endsWith('/reports/exports') && r.body) {
    const input = parse(REQUEST_SCHEMA, JSON.parse(r.body.raw));
    reportOptions(input.reportType, input.parameters, { timezone: 'Asia/Kolkata' });
  }
  for (const [argKey, arg] of Object.entries(args)) {
    const kind = Number(argKey.split(':')[0]),
      dto = types[arg.index];
    if (kind === 6 && ['if-match', 'idempotency-key'].includes(arg.data)) {
      assert(
        r.header.some((h) => h.key.toLowerCase() === arg.data && !h.disabled),
        `Missing ${arg.data}: ${key}`,
      );
    }
    if (kind === 3 && dto && dto !== Object && r.body) {
      const raw = r.body.raw.replace(/\{\{(\w+)\}\}/g, (_m, k) => sample(k));
      const instance = plainToInstance(dto, JSON.parse(raw));
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: false,
      });
      assert.equal(
        errors.length,
        0,
        `DTO mismatch: ${key}: ${JSON.stringify(errors.map((e) => ({ property: e.property, constraints: e.constraints })))}`,
      );
      bodyChecks++;
    }
    if (kind === 4 && dto && dto !== Object && r.url.query) {
      for (const p of r.url.query) {
        const value = p.value.replace(/\{\{(\w+)\}\}/g, (_m, k) => sample(k));
        if (!value) continue;
        const errors = validateSync(plainToInstance(dto, { [p.key]: value }), {
          whitelist: true,
          forbidNonWhitelisted: true,
          forbidUnknownValues: false,
        });
        assert.equal(errors.length, 0, `Query DTO mismatch: ${key} ${p.key}`);
        queryChecks++;
      }
    }
  }
  for (const event of item.event) new Script(event.script.exec.join('\n'));
  if (r.method !== 'GET' || path.endsWith('/download')) {
    const code = item.event.find((e) => e.listen === 'prerequest')?.script.exec.join('\n');
    assert(code, `Ungated mutation/download: ${key}`);
    // Verify disarmed, wrong-name, armed once and repeated execution; no network.
    for (const optIn of ['', 'wrong request', item.name]) {
      const state = new Map([['optInRequest', optIn]]);
      let skipped = false;
      const context = {
        pm: {
          environment: {
            get: (k) => state.get(k),
            unset: (k) => state.delete(k),
          },
          info: { requestName: item.name },
          execution: {
            skipRequest: () => {
              skipped = true;
            },
          },
        },
      };
      new Script(code).runInNewContext(context);
      assert.equal(skipped, optIn !== item.name);
      assert(!state.has('optInRequest'));
      skipped = false;
      new Script(code).runInNewContext({ ...context });
      assert(skipped, 'One-shot gate must reject repeat');
    }
    gates++;
  }
  const text = JSON.stringify(item);
  assert(
    !/pm\.(?:sendRequest|execution\.(?:runRequest|setNextRequest))/.test(text),
    'Automatic network/workflow',
  );
  assert(!/console\./.test(test), 'Response console logging');
  assert(
    !/environment\.set\(['"](?:accessToken|password|invitationToken|refreshToken)/.test(test),
    'Credential capture',
  );
  for (const match of text.matchAll(/\{\{(\w+)\}\}/g))
    assert(vars.has(match[1]), `Undefined variable ${match[1]}`);
}
assert.equal(requests.length, 65);
assert.equal(new Set(generated).size, 65);
assert.deepEqual([...generated].sort(), [...actual.keys()].sort());
assert.deepEqual([...generated].sort(), documented.sort());
assert.equal(
  collection.info.schema,
  'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
);
for (const v of environment.values)
  if (!['baseUrl', 'browserOrigin'].includes(v.key))
    assert.equal(v.value, '', `Non-placeholder ${v.key}`);
for (const key of vars.keys())
  assert(
    JSON.stringify(collection).includes(`{{${key}}}`) ||
      ['optInRequest', 'expectedStatus', 'expectedErrorCode'].includes(key) ||
      key.endsWith('Version'),
    `Unused variable: ${key}`,
  );
if (process.argv[2]) {
  const schema = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const Ajv = require('ajv');
  const ajv = new Ajv({ schemaId: 'id', meta: false, allErrors: true });
  ajv.addMetaSchema(require('ajv/lib/refs/json-schema-draft-04.json'));
  const validate = ajv.compile(schema);
  assert(validate(collection), JSON.stringify(validate.errors));
  console.log('Official Postman Collection v2.1 schema: PASS.');
} else console.log('Official schema validation skipped: pass downloaded schema path as argument.');
console.log(
  `PASS: ${actual.size} registered routes = ${requests.length} unique requests; ${collection.item.length} folders; ${bodyChecks} DTO bodies, ${queryChecks} query examples, ${gates} one-shot gates; script syntax, placeholders and secret-capture checks. No HTTP requests sent.`,
);
