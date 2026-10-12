import { z } from 'zod';
import { ApiError } from '../api/errors';

export const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const membership = z.object({ id: z.uuid(), role: z.string(), status: z.string() });
const organization = z.object({
  id: z.string().regex(organizationIdPattern),
  legalName: z.string().min(1),
  displayName: z.string().nullable(),
  status: z.string(),
  baseCurrency: z.string(),
  timezone: z.string(),
  membership,
});
export type Organization = z.infer<typeof organization>;
function invalid(): never {
  throw new ApiError(
    'The organization response could not be verified.',
    'INVALID_RESPONSE',
    undefined,
    'invalid-response',
  );
}
export function parseOrganizations(body: unknown): Organization[] {
  // This endpoint is explicitly unpaginated. Reject a changed envelope rather than truncate access.
  const parsed = z
    .object({ data: z.array(organization) })
    .strict()
    .safeParse(body);
  if (!parsed.success) return invalid();
  if (new Set(parsed.data.data.map((item) => item.id)).size !== parsed.data.data.length)
    return invalid();
  return parsed.data.data.filter(
    (item) => item.status === 'ACTIVE' && item.membership.status === 'ACTIVE',
  );
}
export function parseOrganization(body: unknown, expectedId: string): Organization {
  const parsed = z.object({ data: organization }).safeParse(body);
  if (!parsed.success || parsed.data.data.id !== expectedId) return invalid();
  return parsed.data.data;
}
