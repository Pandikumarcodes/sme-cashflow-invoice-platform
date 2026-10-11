import 'reflect-metadata';
import '../test/setup-env.js';
import { readFile } from 'node:fs/promises';
import { RequestMethod } from '@nestjs/common';
const { AppModule } = await import('../dist/app.module.js');
const modules = new Set();
const controllers = new Set();
async function visit(value) {
  const module = await value;
  const type = module?.module ?? module;
  if (!type || modules.has(type)) return;
  modules.add(type);
  for (const controller of [
    ...(Reflect.getMetadata('controllers', type) ?? []),
    ...(module.controllers ?? []),
  ])
    controllers.add(controller);
  for (const child of [...(Reflect.getMetadata('imports', type) ?? []), ...(module.imports ?? [])])
    await visit(child);
}
await visit(AppModule);
const actual = [];
for (const controller of controllers) {
  const prefix = Reflect.getMetadata('path', controller) ?? '';
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = controller.prototype[name];
    const method = Reflect.getMetadata('method', handler);
    if (method === undefined) continue;
    const path = Reflect.getMetadata('path', handler) ?? '';
    actual.push(
      RequestMethod[method] +
        ' ' +
        ('/api/v1/' + prefix + '/' + path).replace(/\/+/g, '/').replace(/\/$/, ''),
    );
  }
}
const inventory = await readFile(new URL('../../docs/api-inventory.md', import.meta.url), 'utf8');
const documented = inventory
  .split('\n')
  .filter((line) => /^\|\s*\d+\s*\|/.test(line))
  .map((line) => {
    const columns = line.split('|').map((column) => column.trim());
    return columns[2] + ' ' + columns[3].slice(1, -1);
  });
const missing = documented.filter((route) => !actual.includes(route));
const extra = actual.filter((route) => !documented.includes(route));
if (
  actual.length !== 65 ||
  documented.length !== 65 ||
  new Set(actual).size !== actual.length ||
  missing.length ||
  extra.length
)
  throw new Error(
    'API inventory mismatch: ' +
      JSON.stringify({ actual: actual.length, documented: documented.length, missing, extra }),
  );
process.stdout.write('API inventory verified: 65 implemented routes, 65 documented routes.\n');
