import type { Session } from '../../auth/session';
import { parseAgingReport } from './contracts';
export async function getAging(
  session: Session,
  org: string,
  currency: string,
  timezone: string,
  asOfDate: string,
  signal: AbortSignal,
) {
  return parseAgingReport(
    (
      await session.request(`/organizations/${org}/analytics/receivables-aging`, {
        query: { asOfDate },
        signal,
      })
    ).body,
    asOfDate,
    currency,
    timezone,
  );
}
