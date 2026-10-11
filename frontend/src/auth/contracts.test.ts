import { expect, it } from 'vitest';
import { registerSchema } from './contracts';
const input = {
  email: ' alex@example.test ',
  firstName: 'Alex',
  lastName: 'Morgan',
  password: '😀'.repeat(12),
};
it('counts password Unicode characters and bytes without changing its value', () => {
  expect(registerSchema.parse(input).password).toBe(input.password);
});
it.each(['a'.repeat(11), 'a'.repeat(129), '😀'.repeat(129)])(
  'rejects passwords outside backend limits',
  (password) => {
    expect(registerSchema.safeParse({ ...input, password }).success).toBe(false);
  },
);
it('rejects blank names and permits trimmed identity email input', () => {
  expect(registerSchema.safeParse(input).success).toBe(true);
  expect(registerSchema.safeParse({ ...input, firstName: ' ' }).success).toBe(false);
});
