const ISO_WEEK_KEY_REGEX = /^(\d{4})-W(\d{2})$/;
const MS_IN_DAY = 24 * 60 * 60 * 1000;

export function getISOWeekKey(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / MS_IN_DAY) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getWeekDateRange(weekKey: string): { start: Date; end: Date } {
  const match = ISO_WEEK_KEY_REGEX.exec(weekKey);
  if (!match) {
    throw new Error(`Invalid ISO week key: ${weekKey}`);
  }

  const year = Number(match[1]);
  const week = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) {
    throw new Error(`Invalid ISO week key: ${weekKey}`);
  }

  // ISO week 1 contains January 4th.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Monday = 1, Sunday = 7.
  const monday = new Date(jan4.getTime());
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday.getTime());
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

export function getPreviousWeekKey(weekKey: string): string {
  const { start } = getWeekDateRange(weekKey);
  const previousWeekDate = new Date(start.getTime() - 7 * MS_IN_DAY);
  return getISOWeekKey(previousWeekDate);
}

