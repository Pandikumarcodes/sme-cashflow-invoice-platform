import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError, isAbortError } from '../api/errors';
import { useOrganization } from './OrganizationContext';
import { parseCreatedOrganization } from './contracts';
import {
  createOrganizationSchema,
  organizationCreationBody,
  type CreateOrganizationInput,
} from './create-contract';
import styles from './Workspace.module.css';

const fields = [
  ['legalName', 'Legal business name', 200, 'Your registered business name'],
  ['displayName', 'Display name (optional)', 200, 'Defaults to your legal name'],
  ['baseCurrency', 'Base currency', undefined, 'Three-letter currency code, such as INR or USD'],
  ['timezone', 'Timezone', 64, 'For example, Asia/Kolkata or UTC'],
] as const;

export function CreateOrganizationPage() {
  const { session } = useAuth();
  const context = useOrganization();
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const [createdId, setCreatedId] = useState<string>();
  const [verifying, setVerifying] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string>();
  const form = useForm<CreateOrganizationInput>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: {
      legalName: '',
      displayName: '',
      baseCurrency: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
  });
  const creation = useMutation({
    retry: false,
    mutationFn: async ({
      input,
      signal,
    }: {
      input: CreateOrganizationInput;
      signal: AbortSignal;
    }) =>
      parseCreatedOrganization(
        (
          await session.request('/organizations', {
            method: 'POST',
            body: organizationCreationBody(input),
            signal,
          })
        ).body,
      ),
  });
  async function activate(id: string, signal: AbortSignal) {
    if (verifying || signal.aborted) return;
    setVerifying(true);
    try {
      await context.activateCreatedOrganization(id, signal);
    } catch (failure) {
      if (!signal.aborted && !isAbortError(failure))
        setError(
          'Your organization was created, but access could not be verified. Retry the access check.',
        );
    } finally {
      if (!signal.aborted) setVerifying(false);
    }
  }
  async function submit(input: CreateOrganizationInput) {
    if (creation.isPending || createdId || uncertain) return;
    const signal = controller.current.signal;
    setError(undefined);
    try {
      const organization = await creation.mutateAsync({ input, signal });
      if (signal.aborted) return;
      setCreatedId(organization.id);
      await activate(organization.id, signal);
    } catch (failure) {
      if (signal.aborted || isAbortError(failure)) return;
      if (failure instanceof ApiError) {
        if (failure.kind !== 'http' || (failure.status ?? 0) >= 500) setUncertain(true);
        for (const field of failure.fields)
          if (fields.some(([name]) => name === field.field))
            form.setError(field.field as keyof CreateOrganizationInput, { message: field.message });
        if (failure.code === 'INVALID_CURRENCY')
          form.setError('baseCurrency', {
            message: 'This currency is not supported by the service.',
          });
        if (failure.code === 'INVALID_TIMEZONE')
          form.setError('timezone', { message: 'This timezone is not supported by the service.' });
        setError(
          failure.kind === 'http' && (failure.status ?? 0) < 500
            ? failure.message
            : 'Creation could not be confirmed. Check your workspace before trying again.',
        );
      } else {
        setUncertain(true);
        setError('Creation could not be confirmed. Check your workspace before trying again.');
      }
    }
  }
  return (
    <section className={styles.card}>
      <p className={styles.eyebrow}>Set up your workspace</p>
      <h1>Create Organization</h1>
      <p>Bring your customers, invoices and cash flow together in one workspace.</p>
      <p>Choose your base currency carefully. It cannot change after financial activity begins.</p>
      {error && <p role="alert">{error}</p>}
      {createdId ? (
        <>
          <p role="status">Organization created. Verifying your active membership.</p>
          <button
            className={styles.createAction}
            disabled={form.formState.isSubmitting || verifying}
            onClick={() => {
              setError(undefined);
              void activate(createdId, controller.current.signal);
            }}
          >
            Retry access check
          </button>
        </>
      ) : (
        <form
          className={styles.createForm}
          onSubmit={(event) => void form.handleSubmit(submit)(event)}
          noValidate
        >
          <fieldset disabled={form.formState.isSubmitting || uncertain}>
            {fields.map(([name, label, maxLength, hint]) => (
              <div key={name} className={styles.createField}>
                <label htmlFor={name}>{label}</label>
                <input
                  {...form.register(name)}
                  id={name}
                  required={name !== 'displayName'}
                  maxLength={maxLength}
                  autoComplete={name === 'legalName' ? 'organization' : 'off'}
                  aria-invalid={!!form.formState.errors[name]}
                  aria-describedby={`${name}-hint${form.formState.errors[name] ? ` ${name}-error` : ''}`}
                />
                <p id={`${name}-hint`}>{hint}</p>
                {form.formState.errors[name] && (
                  <p id={`${name}-error`} role="alert">
                    {form.formState.errors[name]?.message}
                  </p>
                )}
              </div>
            ))}
            <button className={styles.createAction} type="submit">
              {form.formState.isSubmitting ? 'Creating organization…' : 'Create Organization'}
            </button>
          </fieldset>
        </form>
      )}
      <p>
        <Link to="/workspace">Back to workspace</Link>
      </p>
    </section>
  );
}
