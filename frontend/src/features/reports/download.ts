import type { ApiResponse } from '../../api/client';
import { invalidReport, reportTypes } from './contracts';
export function parseCsvDownload(response: ApiResponse<Blob>, id: string) {
  const mime = response.headers.get('Content-Type') ?? '';
  if (
    response.status !== 200 ||
    !/^text\/csv\s*(?:;\s*charset=utf-8)?$/i.test(mime) ||
    !response.body ||
    response.body.size > 10 * 1024 * 1024
  )
    return invalidReport();
  const disposition = response.headers.get('Content-Disposition');
  const candidate = disposition
    ? /^attachment;\s*filename="([a-z_]+-[0-9a-f-]{36}\.csv)"$/i.exec(disposition)?.[1]
    : undefined;
  if (
    disposition &&
    (!candidate || !reportTypes.some((type) => candidate === `${type.toLowerCase()}-${id}.csv`))
  )
    return invalidReport();
  return { blob: response.body, filename: candidate ?? `report-${id}.csv` };
}
export function saveCsv(blob: Blob, filename: string, signal: AbortSignal) {
  if (signal.aborted) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    if (!signal.aborted) anchor.click();
  } finally {
    anchor.remove();
    const release = () => {
      window.clearTimeout(timer);
      signal.removeEventListener('abort', release);
      URL.revokeObjectURL(url);
    };
    const timer = window.setTimeout(release, 1000);
    signal.addEventListener('abort', release, { once: true });
    if (signal.aborted) release();
  }
}
