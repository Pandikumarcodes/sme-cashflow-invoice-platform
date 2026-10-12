import type { Session } from '../../auth/session';
import { InvoiceDecimal } from '../invoices/calculation';
import {
  invalidPayment,
  parsePayment,
  parsePaymentList,
  recordSchema,
  reversalSchema,
  type RecordInput,
  type ReversalInput,
  type PaymentFilters,
} from './contracts';
const root = (org: string) => `/organizations/${org}/payments`;
export async function listPayments(
  session: Session,
  org: string,
  currency: string,
  filters: PaymentFilters,
  after: string | undefined,
  signal: AbortSignal,
) {
  const query = Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  return parsePaymentList(
    (await session.request(root(org), { query: { ...query, after }, signal })).body,
    org,
    currency,
    filters,
  );
}
export async function getPayment(
  session: Session,
  org: string,
  currency: string,
  id: string,
  signal: AbortSignal,
) {
  return parsePayment(
    (await session.request(`${root(org)}/${id}`, { signal })).body,
    org,
    currency,
    id,
  );
}
export type PaymentAttempt =
  | { key: string; resourceId: string; operation: 'record'; body: RecordInput }
  | { key: string; resourceId: string; operation: 'reverse'; body: ReversalInput };
export async function submitPayment(
  session: Session,
  org: string,
  currency: string,
  attempt: PaymentAttempt,
  signal: AbortSignal,
) {
  const recording = attempt.operation === 'record';
  const response = await session.request(
    recording
      ? `/organizations/${org}/invoices/${attempt.resourceId}/payments`
      : `${root(org)}/${attempt.resourceId}/reverse`,
    {
      method: 'POST',
      body: recording ? recordSchema.parse(attempt.body) : reversalSchema.parse(attempt.body),
      idempotencyKey: attempt.key,
      signal,
      // Financial attempts are retried only by an explicit same-key user action.
    },
  );
  const payment = parsePayment(
    response.body,
    org,
    currency,
    recording ? undefined : attempt.resourceId,
    recording ? attempt.resourceId : undefined,
  );
  if (
    response.status !== (recording ? 201 : 200) ||
    payment.status !== (recording ? 'RECORDED' : 'REVERSED')
  )
    return invalidPayment();
  if (
    attempt.operation === 'record'
      ? !new InvoiceDecimal(payment.amount).eq(attempt.body.amount) ||
        payment.method !== attempt.body.method ||
        payment.paymentDate !== attempt.body.paymentDate
      : payment.reversal?.reason !== attempt.body.reason.trim() ||
        payment.reversal?.reversalDate !== attempt.body.reversalDate
  )
    return invalidPayment();
  return { payment, replayed: response.headers.get('Idempotency-Replayed') === 'true' };
}
