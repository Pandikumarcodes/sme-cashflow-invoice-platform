import type { Session } from '../../auth/session';
import {
  inputSchema,
  parseInvoice,
  parseInvoiceList,
  invalidInvoice,
  reasonSchema,
  type InvoiceFilters,
  type InvoiceInput,
  type InvoiceResource,
} from './contracts';
export type InvoiceAction = 'issue' | 'cancel' | 'void' | 'delete';
const root = (org: string) => `/organizations/${org}/invoices`;
export async function listInvoices(
  session: Session,
  org: string,
  currency: string,
  filters: InvoiceFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  const query = Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const response = await session.request(root(org), { query: { ...query, after }, signal });
  return parseInvoiceList(response.body, org, currency, filters);
}
export async function getInvoice(
  session: Session,
  org: string,
  currency: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(org)}/${id}`, { signal });
  return parseInvoice(response.body, response.headers, org, currency, id);
}
export async function saveInvoice(
  session: Session,
  org: string,
  currency: string,
  input: InvoiceInput,
  signal: AbortSignal,
  resource?: InvoiceResource,
) {
  const response = await session.request(
    `${root(org)}${resource ? `/${resource.invoice.id}` : ''}`,
    {
      method: resource ? 'PATCH' : 'POST',
      body: inputSchema.parse(input),
      ifMatch: resource?.etag,
      signal,
    },
  );
  const result = parseInvoice(response.body, response.headers, org, currency, resource?.invoice.id);
  if (result.invoice.status !== 'DRAFT') return invalidInvoice();
  return result;
}
export async function transitionInvoice(
  session: Session,
  org: string,
  currency: string,
  resource: InvoiceResource,
  action: InvoiceAction,
  reason: string,
  signal: AbortSignal,
) {
  const response = await session.request(
    `${root(org)}/${resource.invoice.id}${action === 'delete' ? '' : `/${action}`}`,
    {
      method: action === 'delete' ? 'DELETE' : 'POST',
      body: action === 'cancel' || action === 'void' ? reasonSchema.parse({ reason }) : {},
      ifMatch: action === 'delete' || action === 'issue' ? resource.etag : undefined,
      signal,
    },
  );
  if (action === 'delete') {
    if (response.status !== 204 || response.body !== undefined) return invalidInvoice();
    return undefined;
  }
  const result = parseInvoice(response.body, response.headers, org, currency, resource.invoice.id);
  if (
    result.invoice.status !==
    (action === 'issue' ? 'ISSUED' : action === 'cancel' ? 'CANCELLED' : 'VOID')
  )
    return invalidInvoice();
  return result;
}
