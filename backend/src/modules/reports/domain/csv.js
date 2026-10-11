import { ApplicationError } from '../../../common/errors/application-error.js';

// Columns mark trusted numeric/date/id output separately from user-entered text.
export function csvCell(value, text = false) {
  let cell = value === null || value === undefined ? '' : String(value);
  // Include controls before a formula prefix: spreadsheet importers may trim them.
  // eslint-disable-next-line no-control-regex
  if (text && /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/u.test(cell)) cell = "'" + cell;
  return /[,"\r\n]/.test(cell) ? '"' + cell.replaceAll('"', '""') + '"' : cell;
}
export function csvArtifact(columns, rows) {
  if (rows.length > 10000)
    throw new ApplicationError('REPORT_TOO_LARGE', 'Report exceeds the export limit.');
  const content =
    columns.map(([key]) => key).join(',') +
    '\r\n' +
    rows
      .map((row) => columns.map(([key, text]) => csvCell(row[key], text)).join(',') + '\r\n')
      .join('');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > 10 * 1024 * 1024)
    throw new ApplicationError('REPORT_TOO_LARGE', 'Report exceeds the export limit.');
  return bytes;
}
export function reportFileName(row) {
  return `${row.reportType.toLowerCase()}-${row.id}.csv`;
}
export const COLUMNS = {
  INVOICE_REGISTER: [
    ['id'],
    ['invoiceNumber', true],
    ['status'],
    ['customerId'],
    ['customerName', true],
    ['issueDate'],
    ['dueDate'],
    ['currency'],
    ['total'],
    ['paid'],
    ['balance'],
    ['overdue'],
  ],
  PAYMENT_REGISTER: [
    ['id'],
    ['invoiceId'],
    ['invoiceNumber', true],
    ['customerName', true],
    ['paymentDate'],
    ['paymentMethod'],
    ['currency'],
    ['amount'],
  ],
  EXPENSE_REGISTER: [
    ['id'],
    ['expenseDate'],
    ['categoryId'],
    ['categoryName', true],
    ['vendorPayee', true],
    ['description', true],
    ['currency'],
    ['amount'],
  ],
  RECEIVABLES: [['bucket'], ['invoiceCount'], ['amount'], ['currency'], ['asOfDate']],
  CASH_FLOW: [['kind'], ['periodStart'], ['currency'], ['inflows'], ['outflows'], ['netCashFlow']],
  CASH_BASIS_PERFORMANCE: [
    ['kind'],
    ['periodStart'],
    ['categoryId'],
    ['categoryName', true],
    ['currency'],
    ['revenue'],
    ['expenses'],
    ['netResult'],
  ],
};
