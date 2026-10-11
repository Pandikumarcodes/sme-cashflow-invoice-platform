// Only the currently implemented protected route is a valid destination.
export function safeReturnTo(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.includes('\\') ||
    Array.from(value).some((character) => character.charCodeAt(0) <= 32)
  )
    return '/session';
  try {
    const url = new URL(value, 'https://app.invalid');
    if (
      !value.startsWith('/') ||
      value.startsWith('//') ||
      url.origin !== 'https://app.invalid' ||
      url.pathname !== '/session'
    )
      return '/session';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/session';
  }
}
