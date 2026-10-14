import { useState } from 'react';
import { useOrganization } from '../../organizations/OrganizationContext';

import {
  defaultParameters,
  parameterError,
  type ReportType,
  type ReportParameters,
} from './contracts';
import styles from './Reports.module.css';
export function ReportFilters({
  type,
  disabled = false,
  button,
  apply,
}: {
  type: ReportType;
  disabled?: boolean;
  button: string;
  apply: (parameters: ReportParameters) => void;
}) {
  const org = useOrganization().organization!;
  const [values, setValues] = useState(defaultParameters(type, org.timezone));
  const [error, setError] = useState<string>();
  const fields =
    type === 'RECEIVABLES'
      ? ['asOfDate']
      : [
          'fromDate',
          'toDate',
          ...(type === 'INVOICE_REGISTER'
            ? ['asOfDate', 'customerId']
            : type === 'PAYMENT_REGISTER'
              ? ['invoiceId']
              : type === 'EXPENSE_REGISTER'
                ? ['expenseCategoryId', 'vendorPayee']
                : []),
        ];
  const labels: Record<string, string> = {
    fromDate: 'From date',
    toDate: 'To date',
    asOfDate: 'As-of date',
    customerId: 'Customer ID (optional)',
    invoiceId: 'Invoice ID (optional)',
    expenseCategoryId: 'Expense category ID (optional)',
    vendorPayee: 'Exact vendor/payee (optional)',
  };
  return (
    <form
      className={styles.controls}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const parameters = Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== ''),
        );
        const failure = parameterError(type, parameters);
        setError(failure);
        if (!failure) apply(parameters);
      }}
    >
      <fieldset
        className={styles.controls}
        disabled={disabled}
        style={{ border: 0, padding: 0, margin: 0, width: '100%' }}
      >
        <legend>Report parameters ({org.timezone})</legend>
        {fields.map((field) => (
          <label key={field}>
            {labels[field]}
            <input
              type={field.endsWith('Date') ? 'date' : 'text'}
              value={values[field] ?? ''}
              maxLength={field === 'vendorPayee' ? 200 : field.endsWith('Id') ? 36 : undefined}
              onChange={(event) => setValues((old) => ({ ...old, [field]: event.target.value }))}
            />
          </label>
        ))}
        {type === 'INVOICE_REGISTER' && (
          <label>
            Invoice status
            <select
              value={values.status ?? ''}
              onChange={(event) => setValues((old) => ({ ...old, status: event.target.value }))}
            >
              <option value="">Any status</option>
              {['DRAFT', 'ISSUED', 'CANCELLED', 'VOID'].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
        )}
        {['CASH_FLOW', 'CASH_BASIS_PERFORMANCE'].includes(type) && (
          <label>
            Grouping
            <select
              value={values.groupBy}
              onChange={(event) => setValues((old) => ({ ...old, groupBy: event.target.value }))}
            >
              {(type === 'CASH_FLOW' ? ['day', 'week', 'month'] : ['none', 'month']).map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
        )}
        <button>{button}</button>
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  );
}
