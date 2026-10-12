import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm, type FieldError, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '../../auth/AuthContext';
import {
  loginSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '../../auth/contracts';
import { safeReturnTo } from '../../auth/return-to';
import { SessionLoading } from '../../auth/ProtectedRoute';
import { ApiError, isAbortError } from '../../api/errors';
import styles from './AuthPages.module.css';

function authMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS')
      return 'The email or password is incorrect. Please try again.';
    if (error.code === 'EMAIL_UNAVAILABLE')
      return 'This email is unavailable. Try another email or sign in.';
    return error.message;
  }
  return 'We could not complete this request. Please try again.';
}
function Field({
  label,
  registration,
  error,
  password,
  autoComplete,
  maxLength,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  password?: boolean;
  autoComplete: string;
  maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  const id = registration.name;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.inputWrap}>
        <input
          {...registration}
          id={id}
          type={password && !visible ? 'password' : id === 'email' ? 'email' : 'text'}
          autoComplete={autoComplete}
          maxLength={maxLength}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {password && (
          <button
            type="button"
            className={styles.toggle}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.fieldError}>
          {error.message}
        </p>
      )}
    </div>
  );
}
function destination(state: unknown) {
  return safeReturnTo(
    state && typeof state === 'object' && 'returnTo' in state ? state.returnTo : undefined,
  );
}

export function LoginPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const [error, setError] = useState<string>();
  if (auth.status === 'checking') return <SessionLoading />;
  if (auth.status === 'authenticated') return <Navigate to={destination(location.state)} replace />;
  const submit = form.handleSubmit(async (input) => {
    if (auth.busy) return;
    setError(undefined);
    try {
      await auth.session.login(input);
      form.reset();
      navigate(destination(location.state), { replace: true });
    } catch (failure) {
      if (isAbortError(failure)) return;
      if (failure instanceof ApiError)
        for (const field of failure.fields) {
          if (field.field === 'email' || field.field === 'password')
            form.setError(field.field, { message: field.message });
        }
      setError(authMessage(failure));
    }
  });
  return (
    <section className={styles.shell}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>Your business, in focus</p>
        <h1>Welcome back.</h1>
        <p>Sign in to your cashflow workspace.</p>
        <div className={styles.note}>
          A clear place to begin.
          <br />
          Built for the business you’re building.
        </div>
      </div>
      <div className={styles.card}>
        <h2>Sign in</h2>
        <p className={styles.subtitle}>Use your account email and password.</p>
        {location.state &&
          typeof location.state === 'object' &&
          'registered' in location.state &&
          location.state.registered === true && (
            <p role="status" className={styles.success}>
              Your account is ready. Sign in to continue.
            </p>
          )}
        {(error || auth.error) && (
          <p role="alert" className={styles.error}>
            {error ?? auth.error}
          </p>
        )}
        <form onSubmit={submit} noValidate aria-label="Sign in">
          <Field
            label="Email address"
            registration={form.register('email')}
            error={form.formState.errors.email}
            autoComplete="username"
            maxLength={320}
          />
          <Field
            label="Password"
            registration={form.register('password')}
            error={form.formState.errors.password}
            password
            autoComplete="current-password"
            maxLength={512}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={form.formState.isSubmitting || auth.busy}
          >
            {form.formState.isSubmitting ? 'Signing in…' : auth.busy ? 'Please wait…' : 'Sign in'}
          </button>
        </form>
        <p className={styles.switch}>
          New here?{' '}
          <Link to="/register" state={{ returnTo: destination(location.state) }}>
            Create an account
          </Link>
        </p>
        {auth.error?.includes('revocation') && (
          <button
            className={styles.secondary}
            disabled={auth.busy}
            onClick={() => {
              void auth.session.logout();
            }}
          >
            Retry sign out
          </button>
        )}
      </div>
    </section>
  );
}

export function RegisterPage() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  });
  const [error, setError] = useState<string>();
  if (auth.status === 'checking') return <SessionLoading />;
  if (auth.status === 'authenticated') return <Navigate to={destination(location.state)} replace />;
  const submit = form.handleSubmit(async (input) => {
    if (auth.busy) return;
    setError(undefined);
    try {
      await auth.session.register(input);
      form.reset();
      navigate('/login', {
        replace: true,
        state: { registered: true, returnTo: destination(location.state) },
      });
    } catch (failure) {
      if (isAbortError(failure)) return;
      if (failure instanceof ApiError)
        for (const field of failure.fields) {
          if (['email', 'password', 'firstName', 'lastName'].includes(field.field))
            form.setError(field.field as keyof RegisterInput, { message: field.message });
        }
      setError(authMessage(failure));
    }
  });
  return (
    <section className={styles.shell}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>A considered start</p>
        <h1>Your next chapter starts here.</h1>
        <p>Create your personal account. Your organization workspace comes later.</p>
      </div>
      <div className={styles.card}>
        <h2>Create an account</h2>
        <p className={styles.subtitle}>A few details to get you started.</p>
        {(error || auth.error) && (
          <p role="alert" className={styles.error}>
            {error ?? auth.error}
          </p>
        )}
        <form onSubmit={submit} noValidate aria-label="Create an account">
          <div className={styles.names}>
            <Field
              label="First name"
              registration={form.register('firstName')}
              error={form.formState.errors.firstName}
              autoComplete="given-name"
              maxLength={100}
            />
            <Field
              label="Last name"
              registration={form.register('lastName')}
              error={form.formState.errors.lastName}
              autoComplete="family-name"
              maxLength={100}
            />
          </div>
          <Field
            label="Email address"
            registration={form.register('email')}
            error={form.formState.errors.email}
            autoComplete="username"
            maxLength={320}
          />
          <Field
            label="Password"
            registration={form.register('password')}
            error={form.formState.errors.password}
            password
            autoComplete="new-password"
          />
          <p className={styles.hint}>Use 12–128 characters for your password.</p>
          <button
            className={styles.primary}
            type="submit"
            disabled={form.formState.isSubmitting || auth.busy}
          >
            {form.formState.isSubmitting
              ? 'Creating account…'
              : auth.busy
                ? 'Please wait…'
                : 'Create account'}
          </button>
        </form>
        <p className={styles.switch}>
          Already have an account?{' '}
          <Link to="/login" state={{ returnTo: destination(location.state) }}>
            Sign in
          </Link>
        </p>
      </div>
    </section>
  );
}

export function SessionPage() {
  const { user, session, busy } = useAuth();
  const navigate = useNavigate();
  return (
    <section className={styles.session}>
      <p className={styles.eyebrow}>Your account</p>
      <h1>You’re signed in.</h1>
      <p>Welcome, {user?.firstName}. Your session is ready.</p>
      <p className={styles.subtitle}>
        Business workspace features will arrive in later milestones.
      </p>
      <p>
        <Link to="/workspace">Open organization workspace</Link>
      </p>
      <button
        className={styles.primary}
        disabled={busy}
        onClick={() => {
          const pending = session.logout();
          navigate('/login', { replace: true });
          void pending;
        }}
      >
        Sign out
      </button>
    </section>
  );
}
