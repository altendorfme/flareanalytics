export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export { addDays, localDay, dayStartUtc, dayEndUtc } from "../shared/tz";

export const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
export const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

export const isDay = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
