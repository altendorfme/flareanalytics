import { addDays, dayEndUtc, dayStartUtc, localDay } from "../shared/tz";

export { addDays };

export const localToday = (timeZone: string) => localDay(Date.now(), timeZone);

export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "12m" | "custom";
export const PERIOD_KEYS: PeriodKey[] = ["today", "yesterday", "7d", "30d", "90d", "12m", "custom"];

export function periodRange(key: PeriodKey, today: string): { from: string; to: string } {
  switch (key) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "30d": return { from: addDays(today, -29), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "12m": return { from: addDays(today, -364), to: today };
    default: return { from: addDays(today, -6), to: today };
  }
}

/** Formatters for the active locale. */
export function formatters(locale: string) {
  const nf = new Intl.NumberFormat(locale);
  const cf = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const dec = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  let regions: Intl.DisplayNames | null = null;
  try { regions = new Intl.DisplayNames([locale], { type: "region" }); } catch { /* unsupported */ }
  const date = (d: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: "UTC" });
  return {
    num: (n: number) => (Math.abs(n) >= 10_000 ? cf.format(n) : nf.format(Math.round(n))),
    full: (n: number) => nf.format(Math.round(n)),
    dec: (n: number) => dec.format(n),
    pct: (n: number) => (n > 0 && n < 0.1
      ? `<${(0.1).toLocaleString(locale)}%`
      // One fixed decimal under 10% ("1.0%" next to "0.9%") so a column never mixes formats.
      : `${n.toLocaleString(locale, { minimumFractionDigits: n < 10 ? 1 : 0, maximumFractionDigits: n < 10 ? 1 : 0 })}%`),
    date,
    /** "22–28 de out." in the same month; the year only when it isn't the current one. */
    range: (from: string, to: string) => {
      const thisYear = new Date().getUTCFullYear();
      const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC",
        ...(Number(from.slice(0, 4)) !== thisYear || Number(to.slice(0, 4)) !== thisYear ? { year: "numeric" } : {}) };
      const a = new Date(`${from}T12:00:00Z`), b = new Date(`${to}T12:00:00Z`);
      if (from === to) return a.toLocaleDateString(locale, opts);
      const df = new Intl.DateTimeFormat(locale, opts);
      return typeof df.formatRange === "function" ? df.formatRange(a, b) : `${df.format(a)} – ${df.format(b)}`;
    },
    country: (code: string) => {
      if (!/^[A-Za-z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
      try { return regions?.of(code.toUpperCase()) ?? code; } catch { return code; }
    },
    /** Local time in the locale's format (14:15 / 2:15 PM). */
    clock: (d: Date, timeZone: string) =>
      d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone }),
    /** Local day of an instant (YYYY-MM-DD). */
    localDate: (d: Date, timeZone: string) => localDay(d, timeZone),
    /** "3 hours ago". */
    ago: (d: Date) => {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
      const min = Math.round((d.getTime() - Date.now()) / 60_000);
      if (Math.abs(min) < 60) return rtf.format(min, "minute");
      const h = Math.round(min / 60);
      if (Math.abs(h) < 48) return rtf.format(h, "hour");
      return rtf.format(Math.round(h / 24), "day");
    },
  };
}
export type Formatters = ReturnType<typeof formatters>;

/** Percent change; null without a comparison base. */
export const delta = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

/** X-axis label: local hour (14h / 2 PM) or short day. */
export function tickLabel(t: string, unit: "hour" | "day", timeZone: string, locale: string) {
  if (unit === "day") return new Date(`${t}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const h = new Date(t).toLocaleTimeString(locale, { hour: "numeric", timeZone });
  // A bare "14" doesn't read as an hour, so 24h locales get "14h".
  return /^\d+$/.test(h) ? `${Number(h)}h` : h;
}

/**
 * Fills gaps with zero (hours without traffic aren't stored). In the hourly series `until`
 * (the last collection) is the end: later hours haven't been fetched and must not show as zero.
 */
export function fillSeries(
  points: { t: string; pageviews: number; visits: number }[],
  unit: "hour" | "day", from: string, to: string, timeZone: string, until = Date.now(),
) {
  const map = new Map(points.map((p) => [p.t, p]));
  const out: { t: string; pageviews: number; visits: number }[] = [];
  if (unit === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? { t: d, pageviews: 0, visits: 0 });
    return out;
  }
  const start = dayStartUtc(from, timeZone).getTime();
  const end = Math.min(dayEndUtc(to, timeZone).getTime(), until + 1);
  for (let ms = start; ms < end; ms += 3_600_000) {
    const t = new Date(ms).toISOString().replace(".000Z", "Z");
    out.push(map.get(t) ?? { t, pageviews: 0, visits: 0 });
  }
  return out;
}

/** User-token template with both permissions preselected. */
export const TOKEN_TEMPLATE_URL =
  "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=" +
  encodeURIComponent(JSON.stringify([
    { key: "account_analytics", type: "read" },
    { key: "account_settings", type: "read" },
  ])) +
  "&accountId=*&zoneId=all&name=FlareAnalytics";

/** Cloudflare RUM names → readable names. */
const AGENT_NAMES: Record<string, string> = {
  MobileSafari: "Safari Mobile", MobileSafariUIWebView: "Safari WebView", ChromeMobile: "Chrome Mobile",
  ChromeMobileWebView: "Chrome WebView", ChromeMobileIOS: "Chrome (iOS)", FirefoxMobile: "Firefox Mobile",
  FirefoxiOS: "Firefox (iOS)", SamsungInternet: "Samsung Internet", EdgeMobile: "Edge Mobile", HeadlessChrome: "Headless Chrome",
  OperaMobile: "Opera Mobile", MacOSX: "macOS", ChromeOS: "ChromeOS", iOS: "iOS", iPadOS: "iPadOS",
};
export const agentName = (v: string) => AGENT_NAMES[v] ?? v.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Collection runs at :15; over 75 min without success means late. */
export const STALE_MS = 75 * 60_000;

/** Next hourly cron run (minute 15, as in wrangler.jsonc). */
export function nextCollection(now = Date.now()) {
  const next = Math.floor(now / 3_600_000) * 3_600_000 + 15 * 60_000;
  return new Date(next > now ? next : next + 3_600_000);
}

/** Collector errors: `detail` is the result JSON with `errors: string[]`. */
export function runErrors(detail: string | null | undefined): string[] {
  if (!detail) return [];
  try {
    const errs = JSON.parse(detail)?.errors;
    if (Array.isArray(errs)) return errs.filter((e): e is string => typeof e === "string").map(cleanError);
  } catch { /* detail truncated at 2000 chars */ }
  return [cleanError(detail)];
}

/** Strips the account id and raw body, leaving "HTTP 403: <Cloudflare message>". */
function cleanError(raw: string) {
  const s = raw.replace(/^[0-9a-f]{32}: /, "");
  const http = /^HTTP (\d{3}) em \S+?:\s*(.*)$/s.exec(s);
  if (!http) return s.slice(0, 240);
  const msg = /"message"\s*:\s*"([^"]+)"/.exec(http[2])?.[1];
  return `HTTP ${http[1]}${msg ? `: ${msg}` : ""}`;
}

/** Cloudflare rejected the token (revoked, expired or missing permission). */
export const isTokenError = (msg: string) => /^HTTP 40[13]\b|authenticat|not authorized|unauthorized|permission/i.test(msg);

export interface Bucket { t: string; pageviews: number; visits: number }

/**
 * In-progress bucket (hour or day still being collected) when the period ends today. In a
 * single-day hourly series its value is the day total minus closed hours (adjusts `filled` in
 * place). `fraction` is how much of the bucket was collected, up to the last collection.
 */
export function partialBucket(
  filled: Bucket[], unit: "hour" | "day", from: string, to: string, today: string,
  totals: { pageviews: number; visits: number }, lastRun: string | null, timeZone: string,
): { index: number; fraction: number; elapsedMin: number; asOf: Date } | null {
  if (to !== today || !filled.length) return null;
  if (unit === "hour" && from !== to) return null;
  const index = filled.length - 1;
  if (unit === "hour") {
    const closed = filled.slice(0, -1);
    const last = filled[index];
    const sum = (k: "pageviews" | "visits") => closed.reduce((a, p) => a + p[k], 0);
    last.pageviews = Math.max(last.pageviews, totals.pageviews - sum("pageviews"));
    last.visits = Math.max(last.visits, totals.visits - sum("visits"));
  }
  const asOf = lastRun ? new Date(lastRun) : new Date();
  // Late collection (same threshold as the freshness line): no orange, no projection on stale data.
  if (Date.now() - asOf.getTime() > STALE_MS) return null;
  const t = filled[index].t;
  const start = unit === "hour" ? Date.parse(t) : dayStartUtc(t, timeZone).getTime();
  const len = unit === "hour" ? 3_600_000 : dayEndUtc(t, timeZone).getTime() - start;
  const fraction = Math.min(Math.max((asOf.getTime() - start) / len, 0), 1);
  return { index, fraction, elapsedMin: Math.round((asOf.getTime() - start) / 60_000), asOf };
}

/** Projects the bucket at the current pace; under 10% collected it's noise. */
export const project = (value: number, fraction: number) => (fraction < 0.1 ? null : value / fraction);
