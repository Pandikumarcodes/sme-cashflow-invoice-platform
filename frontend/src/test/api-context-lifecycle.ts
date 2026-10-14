// Test-only ownership: release contexts even when a setup step or assertion fails.
export async function withApiContexts<T extends { dispose(): Promise<void> }>(
  create: () => Promise<T>,
  run: (createOwned: () => Promise<T>) => Promise<void>,
) {
  const contexts: T[] = [];
  let failed = false;
  let primaryError: unknown;
  try {
    await run(async () => {
      const context = await create();
      contexts.push(context);
      return context;
    });
  } catch (error) {
    failed = true;
    primaryError = error;
  }
  const results = await Promise.allSettled(contexts.map((context) => context.dispose()));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      [...(failed ? [primaryError] : []), ...failures.map((result) => result.reason)],
      'Test context cleanup failed.',
    );
  if (failed) throw primaryError;
}
