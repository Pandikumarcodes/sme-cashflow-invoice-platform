import { act } from '@testing-library/react';
import type { createMemoryRouter } from 'react-router-dom';

// A lazy route's import is a separate phase from the component's API queries.
// Observe the router's completion event instead of racing cold imports against a DOM poll.
export async function routerReady(router: ReturnType<typeof createMemoryRouter>) {
  if (!router.state.initialized) {
    await new Promise<void>((resolve) => {
      const unsubscribe = router.subscribe((state) => {
        if (state.initialized) {
          unsubscribe();
          resolve();
        }
      });
    });
  }
  // Do not keep React's global async act scope open across a module import.
  // A runner timeout or host suspension must not poison the next test's rendering.
  act(() => {});
}
