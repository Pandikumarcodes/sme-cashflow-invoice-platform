import { expect, it, vi } from 'vitest';
import { withApiContexts } from './api-context-lifecycle';

it('disposes every acquired context when an assertion aborts the journey', async () => {
  const contexts = [{ dispose: vi.fn(async () => {}) }, { dispose: vi.fn(async () => {}) }];
  let index = 0;
  const failure = new Error('Assertion failed');
  await expect(
    withApiContexts(
      async () => contexts[index++]!,
      async (create) => {
        await create();
        await create();
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
  for (const context of contexts) expect(context.dispose).toHaveBeenCalledOnce();
});

it('releases earlier contexts when later acquisition fails', async () => {
  const context = { dispose: vi.fn(async () => {}) };
  const failure = new Error('Context creation failed');
  const create = vi.fn().mockResolvedValueOnce(context).mockRejectedValueOnce(failure);
  await expect(
    withApiContexts(create, async (owned) => {
      await owned();
      await owned();
    }),
  ).rejects.toBe(failure);
  expect(context.dispose).toHaveBeenCalledOnce();
});
