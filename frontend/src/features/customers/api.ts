import type { Session } from '../../auth/session';
import { ApiError } from '../../api/errors';
import {
  parseCustomer,
  parseCustomerList,
  customerPayload,
  type CustomerFilters,
  type CustomerFormValues,
} from './contracts';
const root = (organizationId: string) => `/organizations/${organizationId}/customers`;
export async function listCustomers(
  session: Session,
  organizationId: string,
  filters: CustomerFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  const response = await session.request(root(organizationId), {
    signal,
    query: { ...filters, search: filters.search || undefined, after },
  });
  return parseCustomerList(response.body, organizationId, filters.limit, filters.status);
}
export async function getCustomer(
  session: Session,
  organizationId: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(organizationId)}/${id}`, { signal });
  return parseCustomer(response.body, response.headers, organizationId, id);
}
export async function createCustomer(
  session: Session,
  organizationId: string,
  values: CustomerFormValues,
  signal: AbortSignal,
) {
  // This endpoint has no key-based idempotency or automatic auth replay contract.
  const response = await session.request(root(organizationId), {
    method: 'POST',
    body: customerPayload(values),
    signal,
  });
  return parseCustomer(response.body, response.headers, organizationId);
}
export async function updateCustomer(
  session: Session,
  organizationId: string,
  id: string,
  etag: string,
  values: CustomerFormValues,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(organizationId)}/${id}`, {
    method: 'PATCH',
    body: customerPayload(values),
    ifMatch: etag,
    signal,
  });
  return parseCustomer(response.body, response.headers, organizationId, id);
}
export async function archiveCustomer(
  session: Session,
  organizationId: string,
  id: string,
  signal: AbortSignal,
) {
  const response = await session.request(`${root(organizationId)}/${id}/archive`, {
    method: 'POST',
    body: {},
    signal,
  });
  const resource = parseCustomer(response.body, response.headers, organizationId, id);
  if (resource.customer.status !== 'ARCHIVED')
    throw new ApiError(
      'The archive response could not be verified.',
      'INVALID_RESPONSE',
      undefined,
      'invalid-response',
    );
  return resource;
}
