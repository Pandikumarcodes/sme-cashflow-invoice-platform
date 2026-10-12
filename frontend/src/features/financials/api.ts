import type { Session } from '../../auth/session';
import {
  parseCashReport,
  parseProfitReport,
  type Period,
  type CashGrouping,
  type ProfitGrouping,
} from './contracts';
export async function getCashFlow(
  session: Session,
  org: string,
  currency: string,
  timezone: string,
  range: Period,
  groupBy: CashGrouping,
  signal: AbortSignal,
) {
  return parseCashReport(
    (
      await session.request(`/organizations/${org}/cash-flow`, {
        query: { ...range, groupBy },
        signal,
      })
    ).body,
    range,
    groupBy,
    currency,
    timezone,
  );
}
export async function getProfitLoss(
  session: Session,
  org: string,
  currency: string,
  timezone: string,
  range: Period,
  groupBy: ProfitGrouping,
  signal: AbortSignal,
) {
  return parseProfitReport(
    (
      await session.request(`/organizations/${org}/profit-loss`, {
        query: { ...range, groupBy },
        signal,
      })
    ).body,
    range,
    groupBy,
    currency,
    timezone,
  );
}
