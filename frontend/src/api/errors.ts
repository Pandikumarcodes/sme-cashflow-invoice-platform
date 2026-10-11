import { z } from 'zod';

const fieldSchema = z.object({ field: z.string(), code: z.string(), message: z.string() });
const envelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
    message: z.string(),
    requestId: z.string().optional(),
    fields: z.array(fieldSchema).optional(),
    details: z.unknown().optional(),
  }),
});

export type ValidationField = z.infer<typeof fieldSchema>;
export type ApiErrorKind = 'http' | 'network' | 'invalid-response';

export class ApiError extends Error {
  readonly name = 'ApiError';
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | undefined,
    readonly kind: ApiErrorKind,
    readonly requestId?: string,
    readonly fields: readonly ValidationField[] = [],
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function safeHttpMessage(status: number) {
  if (status === 401) return 'Please sign in to continue.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource could not be found.';
  if (status === 409)
    return 'This request conflicts with the current record. Refresh and try again.';
  if (status === 429) return 'Too many requests. Please try again shortly.';
  if (status >= 500) return 'The service is unavailable. Please try again later.';
  return 'The request could not be completed. Check your input and try again.';
}

// Structured details are retained for callers; backend free text is discarded.
// user-facing messages come from this allowlist, never HTML, SQL or a raw exception.
export function parseApiError(payload: unknown, status: number, headerRequestId?: string) {
  const parsed = envelopeSchema.safeParse(payload);
  const error = parsed.success ? parsed.data.error : undefined;
  const message =
    error?.code === 'VALIDATION_ERROR'
      ? 'Please check the highlighted fields.'
      : error?.code === 'CONCURRENT_MODIFICATION'
        ? 'This record changed. Refresh it before saving again.'
        : error?.code === 'IDEMPOTENCY_CONFLICT'
          ? 'This request key was already used for a different operation.'
          : safeHttpMessage(status);
  return new ApiError(
    message,
    error?.code ?? 'HTTP_ERROR',
    status,
    'http',
    error?.requestId ?? headerRequestId,
    error?.fields?.map(({ field, code }) => ({ field, code, message: 'Check this field.' })) ?? [],
    error?.details,
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
