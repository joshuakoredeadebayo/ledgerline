/**
 * Schedule arithmetic for recurring entries, with no database access so it can be tested on its own.
 * Dates are plain "YYYY-MM-DD" strings and all arithmetic is in UTC, so a server's time zone can never
 * shift a date by a day.
 *
 *   weekly     every N weeks, on a chosen weekday
 *   monthly    every N months, on a chosen day (31 means "the last day of the month")
 *   quarterly  every N quarters (three months each), same day rule
 *   yearly     every N years, in the start date's month, same day rule
 *
 * A day that doesn't exist in a month (the 30th of February) falls on that month's last day.
 */

export type Frequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface Schedule {
  frequency: Frequency;
  /** Every N weeks, months, quarters or years. */
  intervalCount: number;
  /** 1 to 31; 31 means the last day of the month. Used by monthly, quarterly and yearly. */
  dayOfMonth: number | null;
  /** 0 (Sunday) to 6 (Saturday). Used by weekly. */
  weekday: number | null;
  startDate: string;
  endDate: string | null;
}

export const LAST_DAY = 31;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDate(iso: string): { y: number; m: number; d: number } | null {
  const m = DATE_RE.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(iso: string, days: number): string {
  const p = parseDate(iso)!;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const weekdayOf = (iso: string) => {
  const p = parseDate(iso)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
};

const monthsPerStep = (f: Frequency) => (f === "monthly" ? 1 : f === "quarterly" ? 3 : 12);

/** The n-th occurrence (0 = the first slot on or after the start month/week), before checking it against the start date. */
function occurrence(s: Schedule, n: number): string {
  if (s.frequency === "weekly") {
    const start = s.startDate;
    const target = s.weekday ?? weekdayOf(start);
    const first = addDays(start, (target - weekdayOf(start) + 7) % 7);
    return addDays(first, n * 7 * s.intervalCount);
  }
  const start = parseDate(s.startDate)!;
  const wantedDay = s.dayOfMonth ?? start.d;
  const monthIndex = start.y * 12 + (start.m - 1) + n * monthsPerStep(s.frequency) * s.intervalCount;
  const y = Math.floor(monthIndex / 12);
  const m = (monthIndex % 12) + 1;
  const last = daysInMonth(y, m);
  const day = wantedDay >= LAST_DAY ? last : Math.min(wantedDay, last);
  return fmt(y, m, day);
}

/** The index of the first occurrence on or after the start date (the first slot can fall before it). */
function firstIndex(s: Schedule): number {
  let n = 0;
  while (occurrence(s, n) < s.startDate) n++;
  return n;
}

function daysBetween(a: string, b: string): number {
  const x = parseDate(a)!;
  const y = parseDate(b)!;
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 86_400_000);
}

/**
 * An index at or a little before the first occurrence on/after `date`, found by arithmetic rather than by
 * walking from the start. This keeps the cost of "what's next?" constant however old the schedule is, which
 * matters when the daily job checks thousands of templates.
 */
function indexNear(s: Schedule, date: string): number {
  if (s.frequency === "weekly") {
    const first = occurrence(s, 0);
    return Math.max(0, Math.floor(daysBetween(first, date) / (7 * s.intervalCount)) - 1);
  }
  const start = parseDate(s.startDate)!;
  const d = parseDate(date)!;
  const monthsApart = d.y * 12 + d.m - (start.y * 12 + start.m);
  return Math.max(0, Math.floor(monthsApart / (monthsPerStep(s.frequency) * s.intervalCount)) - 1);
}

/** Occurrences in order starting from index `n`. Stops at the end date. */
function* occurrencesFrom(s: Schedule, n: number): Generator<string> {
  for (let guard = 0; guard < 5000; guard++, n++) {
    const date = occurrence(s, n);
    if (s.endDate && date > s.endDate) return;
    yield date;
  }
}

/** The first date the schedule produces, or null if the end date comes before it. */
export function firstRunDate(s: Schedule): string | null {
  for (const d of occurrencesFrom(s, firstIndex(s))) return d;
  return null;
}

/** The first occurrence strictly after `after`, or null when the schedule has ended. */
export function nextRunDate(s: Schedule, after: string): string | null {
  const n = Math.max(firstIndex(s), indexNear(s, after));
  for (const d of occurrencesFrom(s, n)) if (d > after) return d;
  return null;
}

/** The next `count` occurrences on or after `from`. */
export function upcomingDates(s: Schedule, from: string, count: number): string[] {
  const out: string[] = [];
  const n = Math.max(firstIndex(s), indexNear(s, from));
  for (const d of occurrencesFrom(s, n)) {
    if (d < from) continue;
    out.push(d);
    if (out.length >= count) break;
  }
  return out;
}

export function validateSchedule(s: Schedule): string | null {
  if (!["weekly", "monthly", "quarterly", "yearly"].includes(s.frequency)) return "Choose how often it repeats.";
  if (!Number.isInteger(s.intervalCount) || s.intervalCount < 1 || s.intervalCount > 52) return "The repeat interval must be a whole number from 1 to 52.";
  if (!parseDate(s.startDate)) return "Enter a valid start date.";
  if (s.startDate < "2000-01-01" || s.startDate > "2100-12-31") return "The start date must be between the years 2000 and 2100.";
  if (s.endDate) {
    if (!parseDate(s.endDate)) return "Enter a valid end date.";
    if (s.endDate < s.startDate) return "The end date can't be before the start date.";
  }
  if (s.frequency === "weekly") {
    if (s.weekday === null || !Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) return "Choose a day of the week.";
  } else if (s.dayOfMonth !== null && (!Number.isInteger(s.dayOfMonth) || s.dayOfMonth < 1 || s.dayOfMonth > 31)) {
    return "Choose a day of the month from 1 to 31.";
  }
  if (!firstRunDate(s)) return "The end date comes before the first date it would run.";
  return null;
}

const ordinal = (n: number) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A plain-English summary such as "Monthly on the 25th" or "Every 2 weeks on Friday". */
export function describeSchedule(s: Schedule): string {
  const day = s.dayOfMonth === null ? null : s.dayOfMonth >= LAST_DAY ? "the last day" : `the ${ordinal(s.dayOfMonth)}`;
  switch (s.frequency) {
    case "weekly":
      return `${s.intervalCount === 1 ? "Weekly" : `Every ${s.intervalCount} weeks`} on ${WEEKDAYS[s.weekday ?? 0]}`;
    case "monthly":
      return `${s.intervalCount === 1 ? "Monthly" : `Every ${s.intervalCount} months`}${day ? ` on ${day}` : ""}`;
    case "quarterly":
      return `${s.intervalCount === 1 ? "Quarterly" : `Every ${s.intervalCount} quarters`}${day ? ` on ${day}` : ""}`;
    default: {
      const start = parseDate(s.startDate);
      const month = start ? MONTHS[start.m - 1] : "";
      return `${s.intervalCount === 1 ? "Yearly" : `Every ${s.intervalCount} years`} in ${month}${day ? ` on ${day}` : ""}`;
    }
  }
}

/** "in 3 days", "tomorrow", "today", "5 days ago", for the next-run column. */
export function relativeDay(iso: string, today: string): string {
  const a = parseDate(iso)!;
  const b = parseDate(today)!;
  const diff = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86_400_000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}
