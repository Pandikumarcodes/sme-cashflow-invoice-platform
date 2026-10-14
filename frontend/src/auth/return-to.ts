import { organizationIdPattern } from '../organizations/contracts';
// Only implemented local protected routes are valid destinations.
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
      !(
        url.pathname === '/session' ||
        url.pathname === '/workspace' ||
        /^\/organizations\/new\/?$/.test(url.pathname) ||
        (/^\/organizations\/[^/]+\/(?:workspace|dashboard|notifications|reports|audit-logs|cash-flow|profit-loss|receivables-aging|expense-categories|payments(?:\/new|\/[^/]+)?|(?:customers|invoices|expenses)(?:\/new|\/[^/]+(?:\/edit)?)?)$/.test(
          url.pathname,
        ) &&
          organizationIdPattern.test(url.pathname.split('/')[2] ?? '') &&
          (!url.pathname.split('/')[4] ||
            url.pathname.split('/')[4] === 'new' ||
            organizationIdPattern.test(url.pathname.split('/')[4]!)))
      )
    )
      return '/session';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/session';
  }
}
