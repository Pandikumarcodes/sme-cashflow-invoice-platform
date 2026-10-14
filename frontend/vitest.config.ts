import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // Three serial passes contrasted with two-worker stalls on the Windows host.
    maxWorkers: process.platform === 'win32' ? 1 : 2,
    pool: 'forks',
    isolate: true,
    setupFiles: [
      ...(process.env.TEST_STABILITY_DIAGNOSTICS ? ['./src/test/worker-diagnostics.ts'] : []),
      './src/test/setup.ts',
    ],
    restoreMocks: true,
    clearMocks: true,
    env: { VITE_API_BASE_URL: 'http://localhost:3000/api/v1' },
  },
});
