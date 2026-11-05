const DAY = 86_400_000;
const HOUR = 3_600_000;

export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formats.set(tz, f);
  }
  return f;
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try { format(tz); return true; } catch { return false; }
}

/** Local wall clock minus UTC, in minutes, at instant `ms` (São Paulo = -180). */
export function offsetMin(tz: string, ms: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of format(tz).formatToParts(new Date(ms))) if (type !== "literal") p[type] = Number(value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** Local day (YYYY-MM-DD) of an instant. */
export const localDay = (d: Date | number, tz: string) => {
  const ms = typeof d === "number" ? d : d.getTime();
  return new Date(ms + offsetMin(tz, ms) * 60_000).toISOString().slice(0, 10);
};

/** First UTC instant of local day `day` (YYYY-MM-DD). */
export function dayStartUtc(day: string, tz: string) {
  const g = Date.parse(`${day}T00:00:00Z`);
  let t = g - offsetMin(tz, g) * 60_000;
  t = g - offsetMin(tz, t) * 60_000;
  while (localDay(t, tz) < day) t += HOUR;
  return new Date(t);
}

/** First UTC instant after local day `day` (days may last 23 or 25 hours). */
export const dayEndUtc = (day: string, tz: string) => dayStartUtc(addDays(day, 1), tz);
