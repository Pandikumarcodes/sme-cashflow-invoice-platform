import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const directory = resolve('dist');
const html = await readFile(resolve(directory, 'index.html'), 'utf8');
const entry = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
if (!entry) throw new Error('Build the frontend before measuring initial JavaScript.');
const files = new Set();
async function visit(file) {
  if (files.has(file)) return;
  files.add(file);
  const source = await readFile(file, 'utf8');
  // Follow static imports/re-exports only; dynamic route imports are deliberately excluded.
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+\.js)["']/g))
    await visit(resolve(dirname(file), match[1]));
}
await visit(resolve(directory, entry.replace(/^\//, '')));
let bytes = 0,
  gzipBytes = 0;
for (const file of files) {
  const size = (await stat(file)).size;
  bytes += size;
  gzipBytes += gzipSync(await readFile(file)).length;
  console.info(`${file.slice(directory.length + 1)}: ${(size / 1000).toFixed(2)} kB`);
}
console.info(
  `Initial static graph: ${(bytes / 1000).toFixed(2)} kB; gzip sum ${(gzipBytes / 1000).toFixed(2)} kB.`,
);
