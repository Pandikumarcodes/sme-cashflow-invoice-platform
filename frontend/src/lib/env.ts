import { z } from 'zod';

const schema = z.object({
  VITE_API_BASE_URL: z
    .string()
    .url()
    .refine((value) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname.replace(/\/$/, '') === '/api/v1'
      );
    }),
});

export function parseEnvironment(values: Record<string, unknown>) {
  const result = schema.safeParse(values);
  if (!result.success)
    throw new Error(
      'VITE_API_BASE_URL must be an HTTP(S) URL ending in /api/v1, without credentials, query or fragment.',
    );
  return { apiBaseUrl: result.data.VITE_API_BASE_URL.replace(/\/$/, '') };
}

export const environment = parseEnvironment(import.meta.env);
