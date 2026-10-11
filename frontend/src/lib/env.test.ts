import { expect, it } from 'vitest';
import { parseEnvironment } from './env';

it.each(['http://localhost:3000/api/v1', 'https://api.example.test/api/v1/'])(
  'validates and normalizes %s',
  (url) => {
    expect(parseEnvironment({ VITE_API_BASE_URL: url }).apiBaseUrl).toBe(url.replace(/\/$/, ''));
  },
);
it.each([
  undefined,
  '',
  'ftp://example.test/api/v1',
  'https://example.test',
  'https://user:secret@example.test/api/v1',
  'https://example.test/api/v1?secret=value',
])('rejects invalid configuration without exposing its value', (url) => {
  expect(() => parseEnvironment({ VITE_API_BASE_URL: url })).toThrow(
    'VITE_API_BASE_URL must be an HTTP(S) URL ending in /api/v1',
  );
  try {
    parseEnvironment({ VITE_API_BASE_URL: url });
  } catch (error) {
    expect(String(error)).not.toContain('secret');
  }
});
