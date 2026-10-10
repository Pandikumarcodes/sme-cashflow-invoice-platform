import { ApplicationError } from '../../../common/errors/application-error.js';
import { ERROR_CODES } from '../../../common/errors/error-codes.js';

import { businessDate, localDate } from '../../../common/time/business-date.js';
export { businessDate, localDate } from '../../../common/time/business-date.js';

export function invoiceDates(issueDate, dueDate) {
  const issue = businessDate(issueDate);
  const due = businessDate(dueDate);
  if (due < issue)
    throw new ApplicationError(ERROR_CODES.INVALID_REQUEST, 'Due date cannot precede issue date.');
  return { issueDate: issue, dueDate: due };
}

export function assertDraft(invoice, version, issue = false) {
  if (invoice.status !== 'DRAFT')
    throw new ApplicationError(
      issue ? ERROR_CODES.INVALID_INVOICE_STATE : ERROR_CODES.INVOICE_FINALIZED,
      'Invoice is not a draft.',
    );
  if (invoice.version !== version)
    throw new ApplicationError(
      ERROR_CODES.CONCURRENT_MODIFICATION,
      'Invoice version does not match.',
    );
}

export function settlementState(invoice, timezone, now) {
  let paymentState = 'NOT_APPLICABLE';
  if (invoice.status === 'ISSUED') {
    if (invoice.amountPaid.isZero() && invoice.balanceDue.eq(invoice.total))
      paymentState = 'UNPAID';
    else if (
      invoice.amountPaid.gt('0') &&
      invoice.amountPaid.lt(invoice.total) &&
      invoice.balanceDue.eq(invoice.total.sub(invoice.amountPaid))
    )
      paymentState = 'PARTIALLY_PAID';
    else if (invoice.amountPaid.eq(invoice.total) && invoice.balanceDue.isZero())
      paymentState = 'PAID';
    else
      throw new ApplicationError(
        ERROR_CODES.INTERNAL_ERROR,
        'Invoice settlement state is inconsistent.',
      );
  }
  return {
    paymentState,
    isOverdue:
      invoice.status === 'ISSUED' &&
      invoice.balanceDue.gt('0') &&
      invoice.dueDate.toISOString().slice(0, 10) < localDate(timezone, now),
  };
}
