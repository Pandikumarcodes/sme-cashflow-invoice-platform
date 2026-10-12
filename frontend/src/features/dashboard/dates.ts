export type DateRange = { fromDate: string; toDate: string; asOfDate: string };
export type Preset = 'current-month' | 'previous-month' | 'last-90-days' | 'custom';
export function localToday(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? date
    : undefined;
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): DateRange {
  const date = calendarDate(today)!;
  if (preset === 'last-90-days') {
    date.setUTCDate(date.getUTCDate() - 89);
    return { fromDate: iso(date), toDate: today, asOfDate: today };
  }
  date.setUTCDate(1);
  if (preset === 'previous-month') date.setUTCMonth(date.getUTCMonth() - 1);
  const fromDate = iso(date);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { fromDate, toDate: iso(date), asOfDate: today };
}
export function rangeError(from: string, to: string, today: string) {
  const start = calendarDate(from);
  const end = calendarDate(to);
  if (!start || !end) return 'Enter valid calendar dates.';
  const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
  if (days < 1 || days > 366) return 'Choose an ordered range of at most 366 inclusive days.';
  if (from > today) return 'The range must start on or before the receivables as-of date.';
  return undefined;
}
