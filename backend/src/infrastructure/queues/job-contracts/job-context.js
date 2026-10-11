import { z } from 'zod';

export const JOB_CONTEXT_SCHEMA = z
  .object({
    version: z.literal(1),
    organizationId: z.string().uuid().optional(),
    entityId: z.string().uuid().optional(),
    requestId: z.string().min(1).max(128).optional(),
    actorId: z.string().uuid().optional(),
  })
  .strict();
