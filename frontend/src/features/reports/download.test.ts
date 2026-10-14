import { afterEach, expect, it, vi } from 'vitest';
import { parseCsvDownload, saveCsv } from './download';
import { exportId } from './test-fixtures';
const response = (headers: Record<string, string> = {}) => ({
  status: 200,
  headers: new Headers({ 'Content-Type': 'text/csv; charset=utf-8', ...headers }),
  body: new Blob(['name,amount\r\nÉlodie,10.01\r\n']),
  requestId: undefined,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('returns original Unicode bytes and a deterministic fallback when CORS hides disposition', () => {
  const source = response();
  const file = parseCsvDownload(source, exportId);
  expect(file.blob).toBe(source.body);
  expect(file.filename).toBe(`report-${exportId}.csv`);
});
it('accepts the exact server attachment filename', () => {
  expect(
    parseCsvDownload(
      response({
        'Content-Disposition': `attachment; filename="invoice_register-${exportId}.csv"`,
      }),
      exportId,
    ).filename,
  ).toBe(`invoice_register-${exportId}.csv`);
});
it.each([
  'attachment; filename="../../private.csv"',
  'inline; filename="report.csv"',
  'attachment; filename="unknown-cccccccc-cccc-4ccc-8ccc-cccccccccccc.csv"',
])('rejects unsafe disposition %s', (header) => {
  expect(() => parseCsvDownload(response({ 'Content-Disposition': header }), exportId)).toThrow();
});
it('rejects HTML, oversized artifacts and unexpected status codes', () => {
  expect(() => parseCsvDownload(response({ 'Content-Type': 'text/html' }), exportId)).toThrow();
  expect(() => parseCsvDownload({ ...response(), status: 202 }, exportId)).toThrow();
  expect(() =>
    parseCsvDownload(
      { ...response(), body: new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]) },
      exportId,
    ),
  ).toThrow();
});
it('uses only a transient blob URL and removes the anchor, revoking on scope abort', () => {
  const create = vi.fn(() => 'blob:local-artifact'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('export.csv');
    expect(this.href).toBe('blob:local-artifact');
  });
  const controller = new AbortController(),
    blob = response().body;
  saveCsv(blob, 'export.csv', controller.signal);
  expect(create).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download]')).toBeNull();
  controller.abort();
  expect(revoke).toHaveBeenCalledOnce();
});
it('revokes after the browser can dereference the URL and ignores pre-aborted work', () => {
  vi.useFakeTimers();
  const create = vi.fn(() => 'blob:local'),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  saveCsv(response().body, 'export.csv', new AbortController().signal);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledOnce();
  const controller = new AbortController();
  controller.abort();
  saveCsv(response().body, 'export.csv', controller.signal);
  expect(create).toHaveBeenCalledOnce();
});
