import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { organizationKeys } from '../../organizations/query-keys';
import { ApiError, isAbortError } from '../../api/errors';
import { listExports, getExport, getPreview, createExport, downloadExport } from './api';
import type { ExportFilters, PreviewType, ReportParameters, ReportRequest } from './contracts';
import { saveCsv } from './download';
export const reportKeys = {
  scope: (account: string, org: string) =>
    [...organizationKeys.scope(account, org), 'reports'] as const,
  exports: (account: string, org: string, filters: ExportFilters, after?: string) =>
    [...reportKeys.scope(account, org), 'exports', filters, after ?? null] as const,
  detail: (account: string, org: string, id: string) =>
    [...reportKeys.scope(account, org), 'detail', id] as const,
};
const fresh = { staleTime: 0, gcTime: 0, refetchOnWindowFocus: false };
export function useExports(org: string, filters: ExportFilters, after?: string, enabled = true) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: reportKeys.exports(user!.id, org, filters, after),
    ...fresh,
    enabled,
    queryFn: ({ signal }) => listExports(session, org, filters, after, signal),
  });
}
export function useExportDetail(org: string, id: string, enabled: boolean) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: reportKeys.detail(user!.id, org, id),
    ...fresh,
    enabled,
    queryFn: ({ signal }) => getExport(session, org, id, signal),
  });
}
export function usePreview(
  org: string,
  type: PreviewType,
  parameters: ReportParameters,
  currency: string,
  timezone: string,
  limit: number,
  after?: string,
  enabled = true,
) {
  const { session, user } = useAuth();
  return useQuery({
    queryKey: [
      ...reportKeys.scope(user!.id, org),
      'preview',
      type,
      parameters,
      currency,
      timezone,
      limit,
      after ?? null,
    ],
    ...fresh,
    enabled,
    queryFn: ({ signal }) =>
      getPreview(session, org, type, parameters, currency, timezone, limit, after, signal),
  });
}
type Attempt = { key: string; body: ReportRequest; uncertain: boolean };
export function useCreateExport(org: string) {
  const { session, user } = useAuth();
  const client = useQueryClient();
  const key = [...reportKeys.scope(user!.id, org), 'pending-attempt'];
  const [attempt, setAttempt] = useState(() => client.getQueryData<Attempt>(key));
  const saved = useRef(attempt);
  const [error, setError] = useState<string>();
  const controller = useRef(new AbortController());
  const lock = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  const mutation = useMutation({
    retry: false,
    gcTime: 0,
    mutationKey: [...reportKeys.scope(user!.id, org), 'create'],
    mutationFn: (value: Attempt) =>
      createExport(session, org, value.body, value.key, controller.current.signal),
  });
  async function send(body?: ReportRequest) {
    if (lock.current || controller.current.signal.aborted) return;
    const value =
      saved.current ??
      (body
        ? {
            key: crypto.randomUUID(),
            body: { ...body, parameters: { ...body.parameters } },
            uncertain: false,
          }
        : undefined);
    if (!value) return;
    lock.current = true;
    saved.current = value;
    setAttempt(value);
    setError(undefined);
    client.setQueryDefaults(key, { gcTime: Infinity });
    client.setQueryData(key, value);
    try {
      const row = await mutation.mutateAsync(value);
      if (controller.current.signal.aborted) return;
      client.removeQueries({ queryKey: key, exact: true });
      saved.current = undefined;
      setAttempt(undefined);
      void client.invalidateQueries({ queryKey: [...reportKeys.scope(user!.id, org), 'exports'] });
      return row;
    } catch (failure) {
      if (isAbortError(failure) || controller.current.signal.aborted) return;
      const uncertain =
        value.uncertain ||
        !(failure instanceof ApiError) ||
        failure.kind !== 'http' ||
        (failure.status ?? 0) >= 500;
      if (uncertain) {
        value.uncertain = true;
        setAttempt({ ...value });
        client.setQueryData(key, value);
      } else {
        saved.current = undefined;
        setAttempt(undefined);
        client.removeQueries({ queryKey: key, exact: true });
      }
      setError(
        uncertain
          ? 'Outcome unconfirmed. Retry the same saved request/key or inspect export history before another request.'
          : failure instanceof ApiError
            ? failure.message
            : 'Export request failed.',
      );
    } finally {
      lock.current = false;
    }
  }
  return { send, isPending: mutation.isPending, attempt, error };
}
export function useCsvDownload(org: string) {
  const { session } = useAuth();
  const controller = useRef(new AbortController());
  const lock = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  async function download(id: string) {
    if (lock.current) return;
    lock.current = true;
    setPending(id);
    setError(undefined);
    try {
      const file = await downloadExport(session, org, id, controller.current.signal);
      if (!controller.current.signal.aborted)
        saveCsv(file.blob, file.filename, controller.current.signal);
    } catch (failure) {
      if (!isAbortError(failure) && !controller.current.signal.aborted)
        setError(
          failure instanceof ApiError
            ? ({
                EXPORT_EXPIRED: 'Export expired. Refresh its metadata.',
                EXPORT_NOT_READY: 'Export is not ready. Refresh its status.',
                EXPORT_ARTIFACT_UNAVAILABLE:
                  'The export artifact is unavailable. Refresh or retry later.',
              }[failure.code] ?? failure.message)
            : 'CSV download could not be completed.',
        );
    } finally {
      if (!controller.current.signal.aborted) setPending(undefined);
      lock.current = false;
    }
  }
  return { download, pending, error };
}
