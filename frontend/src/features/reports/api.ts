import type { Session } from '../../auth/session';
import {
  parseExport,
  parseExports,
  parsePreview,
  invalidReport,
  type ReportRequest,
  type ExportFilters,
  type PreviewType,
  type ReportParameters,
} from './contracts';
import { parseCsvDownload } from './download';
export const previewPaths = {
  INVOICE_REGISTER: 'invoices',
  PAYMENT_REGISTER: 'payments',
  EXPENSE_REGISTER: 'expenses',
  RECEIVABLES: 'receivables',
} as const;
const root = (org: string) => `/organizations/${org}`;
export async function listExports(
  session: Session,
  org: string,
  filters: ExportFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  return parseExports(
    (
      await session.request(`${root(org)}/report-exports`, {
        query: {
          limit: filters.limit,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.reportType ? { reportType: filters.reportType } : {}),
          after,
        },
        signal,
      })
    ).body,
    org,
    filters,
  );
}
export async function getExport(session: Session, org: string, id: string, signal: AbortSignal) {
  return parseExport(
    (await session.request(`${root(org)}/report-exports/${id}`, { signal })).body,
    org,
    id,
  );
}
export async function createExport(
  session: Session,
  org: string,
  body: ReportRequest,
  key: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(org)}/reports/exports`, {
    method: 'POST',
    body: { reportType: body.reportType, format: 'CSV', parameters: { ...body.parameters } },
    idempotencyKey: key,
    signal,
  });
  if (response.status !== 202) return invalidReport();
  const row = parseExport(response.body, org);
  if (
    row.reportType !== body.reportType ||
    Object.entries(body.parameters).some(([field, value]) => row.parameters[field] !== value)
  )
    return invalidReport();
  return row;
}
export async function getPreview(
  session: Session,
  org: string,
  type: PreviewType,
  parameters: ReportParameters,
  currency: string,
  timezone: string,
  limit: number,
  after: string | undefined,
  signal: AbortSignal,
) {
  return parsePreview(
    (
      await session.request(`${root(org)}/reports/${previewPaths[type]}`, {
        query: { ...parameters, limit, after },
        signal,
      })
    ).body,
    type,
    parameters,
    currency,
    timezone,
    limit,
  );
}
export async function downloadExport(
  session: Session,
  org: string,
  id: string,
  signal: AbortSignal,
) {
  return parseCsvDownload(
    await session.request<Blob>(`${root(org)}/report-exports/${id}/download`, {
      responseType: 'blob',
      signal,
    }),
    id,
  );
}
