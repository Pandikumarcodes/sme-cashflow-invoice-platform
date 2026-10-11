import { z } from 'zod';
import { ApiError } from '../api/errors';

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  status: z.literal('ACTIVE'),
  emailVerifiedAt: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});
export type User = z.infer<typeof userSchema>;
export const tokenSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
});
export const loginResponseSchema = z.object({ data: tokenSchema.extend({ user: userSchema }) });
export const refreshResponseSchema = z.object({ data: tokenSchema });
export const userResponseSchema = z.object({ data: userSchema });

export function parseAuthResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(
      'The service returned an unexpected authentication response. Please sign in again.',
      'INVALID_RESPONSE',
      undefined,
      'invalid-response',
    );
  return parsed.data;
}

const email = z
  .string()
  .max(320, 'Use at most 320 characters.')
  .refine((value) => z.email().safeParse(value.trim()).success, 'Enter a valid email address.');
export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.').max(512, 'Use at most 512 characters.'),
});
export const registerSchema = z.object({
  email,
  password: z.string().refine((value) => {
    const characters = Array.from(value).length;
    return characters >= 12 && characters <= 128 && new TextEncoder().encode(value).length <= 512;
  }, 'Use 12–128 characters and at most 512 UTF-8 bytes.'),
  firstName: z
    .string()
    .max(100, 'Use at most 100 characters.')
    .refine((value) => /\S/.test(value), 'Enter your first name.'),
  lastName: z
    .string()
    .max(100, 'Use at most 100 characters.')
    .refine((value) => /\S/.test(value), 'Enter your last name.'),
});
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export const currentUserKey = ['auth', 'current-user'] as const;
