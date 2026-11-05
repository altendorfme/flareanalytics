import { Hono, type Context } from "hono";
import { timeZoneOf } from "../env";
import { addDays, dayEndUtc, dayStartUtc, daysBetween, HOUR, iso, isDay, localDay } from "../time";
import { classify, internalSet, type Channel } from "../channels";
import { DIM_KEYS, TAG_RE, type DimKey } from "../collector/rum";
import { allowedSites, fail, loadUser, requireAdmin, requireUser, sameOrigin, type AppEnv } from "../auth/session";
import { auth } from "./auth";
import { admin } from "./admin";

export const api = new Hono<AppEnv>().basePath("/api");

api.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error" }, 500);
});

api.use("*", sameOrigin, loadUser);
api.route("/auth", auth);
api.use("/admin/*", requireAdmin);
api.route("/admin", admin);

// Dashboard reads: login and per-site access required.
const reads = new Hono<AppEnv>();
for (const p of ["/sites", "/overview", "/summary", "/top"]) reads.use(p, requireUser);

interface Period { from: string; to: string; days: number }
interface Range extends Period { site: string }

/** Validates from/to. Returns a Response on error. */
function parsePeriod(c: Context<AppEnv>): Period | Response {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (!isDay(from) || !isDay(to) || from > to) return fail(c, 400, "invalid_range");
  const days = daysBetween(from, to);
  if (days > 3660) return fail(c, 400, "invalid_range");
  return { from, to, days };
}

/** Validates the period and site access. Returns a Response on error. */
async function parseRange(c: Context<AppEnv>): Promise<Range | Response> {
  const site = c.req.query("site") ?? "";
  if (!TAG_RE.test(site)) return fail(c, 400, "invalid_site");
  const p = parsePeriod(c);
  if (p instanceof Response) return p;
  const allowed = await allowedSites(c.env, c.get("user")!);
  if (allowed && !allowed.has(site)) return fail(c, 403, "forbidden");
  return { site, ...p };
}

const sum = (sql: string) => `COALESCE(SUM(${sql}), 0)`;

/** Last successful hourly collection (how far today's data goes). */
async function lastCollection(db: D1Database): Promise<Date | null> {
  const t = await db.prepare(`SELECT MAX(ran_at) AS t FROM collector_runs WHERE job = 'hourly' AND status = 'ok'`).first<string>("t");
  return t ? new Date(t) : null;
}

/**
 * Comparison window. When the period ends today, data stops at the last collection (`asOf`), so
 * the previous period's last day is cut at the same time: whole hours from the hourly series, the
 * partial hour prorated by minutes.
 */
function compareWindow(p: Period, tz: string, asOf: Date | null, now = new Date()) {
  const prevTo = addDays(p.from, -1);
  const prevFrom = addDays(p.from, -p.days);
  const today = localDay(now, tz);
  const partial = p.to === today;
  const todayStart = dayStartUtc(today, tz).getTime();
  const until = Math.min(Math.max(asOf?.getTime() ?? now.getTime(), todayStart), now.getTime());
  const elapsed = until - todayStart;
  const fullHours = Math.floor(elapsed / HOUR);
  const fraction = (elapsed % HOUR) / HOUR;
  const prevLastStart = dayStartUtc(prevTo, tz);
  const prevCut = new Date(prevLastStart.getTime() + fullHours * HOUR);
  const prevLastEnd = dayEndUtc(prevTo, tz);
  return { prevFrom, prevTo, partial, prevLastStart, prevLastEnd, prevCut, fraction, until: new Date(until) };
}
type Compare = ReturnType<typeof compareWindow>;

/** Previous-period totals, one row per listed site. */
function previousTotalsStmt(db: D1Database, sites: string[], w: Compare) {
  // Outside partial mode the whole end day is in the full range and the parts stay empty.
  const fullTo = w.partial ? addDays(w.prevTo, -1) : w.prevTo;
  const lastDay = w.partial ? w.prevTo : "";
  const a = iso(w.prevLastStart), b = w.partial ? iso(w.prevCut) : a, end = w.partial ? iso(w.prevLastEnd) : a;
  return db.prepare(`WITH s(site_tag) AS (SELECT value FROM json_each(?1))
    SELECT s.site_tag,
      (SELECT ${sum("pageviews")} FROM rum_daily d WHERE d.site_tag = s.site_tag AND day BETWEEN ?2 AND ?3) AS full_pv,
      (SELECT ${sum("visits")} FROM rum_daily d WHERE d.site_tag = s.site_tag AND day BETWEEN ?2 AND ?3) AS full_v,
      (SELECT ${sum("pageviews")} FROM rum_hourly h WHERE h.site_tag = s.site_tag AND hour >= ?4 AND hour < ?5) AS part_pv,
      (SELECT ${sum("visits")} FROM rum_hourly h WHERE h.site_tag = s.site_tag AND hour >= ?4 AND hour < ?5) AS part_v,
      (SELECT ${sum("pageviews")} FROM rum_hourly h WHERE h.site_tag = s.site_tag AND hour = ?5) AS frac_pv,
      (SELECT ${sum("visits")} FROM rum_hourly h WHERE h.site_tag = s.site_tag AND hour = ?5) AS frac_v,
      (SELECT COUNT(*) FROM rum_hourly h WHERE h.site_tag = s.site_tag AND hour >= ?4 AND hour < ?6) AS part_rows,
      (SELECT ${sum("pageviews")} FROM rum_daily d WHERE d.site_tag = s.site_tag AND day = ?7) AS last_pv,
      (SELECT ${sum("visits")} FROM rum_daily d WHERE d.site_tag = s.site_tag AND day = ?7) AS last_v
    FROM s`).bind(JSON.stringify(sites), w.prevFrom, fullTo, a, b, end, lastDay);
}

/** Uses the last day's hourly series when present (partial hour prorated), else the whole day. */
function resolvePrevious(row: any, w: Compare) {
  if (!w.partial) return { totals: { pageviews: row.full_pv, visits: row.full_v }, partialCompare: false };
  const partialCompare = row.part_rows > 0;
  return {
    partialCompare,
    totals: partialCompare
      ? {
          pageviews: Math.round(row.full_pv + row.part_pv + w.fraction * row.frac_pv),
          visits: Math.round(row.full_v + row.part_v + w.fraction * row.frac_v),
        }
      : { pageviews: row.full_pv + row.last_pv, visits: row.full_v + row.last_v },
  };
}

/**
 * The previous period's last day cut at the last collection (same maths as the totals), so the daily
 * chart compares "today until 14:35" with "the matching day until 14:35". Null without an hourly series.
 */
function previousCut(row: any, w: Compare) {
  if (!w.partial || !row || !(row.part_rows > 0)) return null;
  return {
    pageviews: Math.round(row.part_pv + w.fraction * row.frac_pv),
    visits: Math.round(row.part_v + w.fraction * row.frac_v),
  };
}

/** Hourly or daily series over a range of local days. */
function seriesStmt(db: D1Database, sites: string[], from: string, to: string, hourly: boolean, tz: string) {
  return hourly
    ? db.prepare(`SELECT site_tag, hour AS t, pageviews, visits FROM rum_hourly
        WHERE site_tag IN (SELECT value FROM json_each(?1)) AND hour >= ?2 AND hour < ?3 ORDER BY hour`)
        .bind(JSON.stringify(sites), iso(dayStartUtc(from, tz)), iso(dayEndUtc(to, tz)))
    : db.prepare(`SELECT site_tag, day AS t, pageviews, visits FROM rum_daily
        WHERE site_tag IN (SELECT value FROM json_each(?1)) AND day BETWEEN ?2 AND ?3 ORDER BY day`)
        .bind(JSON.stringify(sites), from, to);
}

const point = ({ t, pageviews, visits }: any) => ({ t, pageviews, visits });

reads.get("/sites", async (c) => {
  const allowed = await allowedSites(c.env, c.get("user")!);
  const { results } = await c.env.DB.prepare(
    `SELECT s.site_tag, s.host, s.active,
       (SELECT MIN(day) FROM rum_daily d WHERE d.site_tag = s.site_tag) AS first_day
     FROM sites s WHERE s.active = 1 ORDER BY s.host`,
  ).all<{ site_tag: string }>();
  const sites = allowed ? results.filter((s) => allowed.has(s.site_tag)) : results;
  const lastRun = await c.env.DB.prepare(`SELECT MAX(ran_at) AS t FROM collector_runs WHERE job = 'hourly' AND status = 'ok'`)
    .first<string>("t");
  return c.json({ sites, timeZone: timeZoneOf(c.env), lastRun });
});

reads.get("/overview", async (c) => {
  const r = await parseRange(c);
  if (r instanceof Response) return r;
  const limit = Math.min(Number(c.req.query("limit") ?? 10) || 10, 50);
  const db = c.env.DB;
  const tz = timeZoneOf(c.env);
  const hourly = r.days <= 2;
  const w = compareWindow(r, tz, await lastCollection(db));

  const topSql = (dim: DimKey, lim: number | null) => db.prepare(
    `SELECT value, SUM(pageviews) AS pageviews, SUM(visits) AS visits FROM rum_daily_dim
     WHERE site_tag = ?1 AND dim = ?2 AND day BETWEEN ?3 AND ?4
     GROUP BY value ORDER BY ${dim === "ref" ? "visits" : "pageviews"} DESC ${lim ? `LIMIT ${lim}` : ""}`,
  ).bind(r.site, dim, r.from, r.to);

  const vitalsCols = ["lcp", "inp", "cls", "fcp", "ttfb"]
    .map((m) => `${sum(`${m}_good`)} AS ${m}_good, ${sum(`${m}_poor`)} AS ${m}_poor, ${sum(`${m}_total`)} AS ${m}_total,
      SUM(${m}_p75 * ${m}_total) / NULLIF(SUM(CASE WHEN ${m}_p75 IS NOT NULL THEN ${m}_total END), 0) AS ${m}_p75`)
    .join(",\n");

  const listDims = DIM_KEYS.filter((d) => d !== "ref");
  const [cur, prevRaw, series, prevSeries, refs, vitals, prevVitals, ...tops] = await db.batch<any>([
    db.prepare(`SELECT ${sum("pageviews")} AS pageviews, ${sum("visits")} AS visits FROM rum_daily
      WHERE site_tag = ?1 AND day BETWEEN ?2 AND ?3`).bind(r.site, r.from, r.to),
    previousTotalsStmt(db, [r.site], w),
    seriesStmt(db, [r.site], r.from, r.to, hourly, tz),
    seriesStmt(db, [r.site], w.prevFrom, w.prevTo, hourly, tz),
    topSql("ref", null),
    db.prepare(`SELECT ${vitalsCols} FROM rum_daily_vitals WHERE site_tag = ?1 AND day BETWEEN ?2 AND ?3`)
      .bind(r.site, r.from, r.to),
    // Previous period's p75 for the Vitals comparison (whole days: vitals are only stored daily).
    db.prepare(`SELECT ${vitalsCols} FROM rum_daily_vitals WHERE site_tag = ?1 AND day BETWEEN ?2 AND ?3`)
      .bind(r.site, w.prevFrom, w.prevTo),
    ...listDims.map((d) => topSql(d, limit)),
  ]);

  const { totals: previous, partialCompare } = resolvePrevious(prevRaw.results[0], w);

  const top: Record<string, any[]> = {};
  listDims.forEach((d, i) => (top[d] = tops[i].results));

  // Referrers: drop direct (empty) and internal navigation; channels aggregate by visits.
  const site = await db.prepare(`SELECT host FROM sites WHERE site_tag = ?1`).bind(r.site).first<string>("host");
  const internal = internalSet([site ?? "", ...top.host.map((h: any) => h.value)]);
  const channels = new Map<Channel, { pageviews: number; visits: number }>();
  const referrers: any[] = [];
  for (const row of refs.results) {
    const ch = classify(row.value, internal);
    const agg = channels.get(ch) ?? { pageviews: 0, visits: 0 };
    agg.pageviews += row.pageviews;
    agg.visits += row.visits;
    channels.set(ch, agg);
    if (ch !== "direct" && ch !== "internal" && referrers.length < limit) referrers.push({ ...row, channel: ch });
  }
  channels.delete("internal");

  return c.json({
    range: {
      ...r, prevFrom: w.prevFrom, prevTo: w.prevTo, unit: hourly ? "hour" : "day",
      partialCompare, compareUntil: partialCompare ? w.until.toISOString() : null,
    },
    summary: { current: cur.results[0], previous },
    series: series.results.map(point),
    previousSeries: prevSeries.results.map(point),
    previousCut: previousCut(prevRaw.results[0], w),
    top: { ...top, ref: referrers },
    channels: [...channels].map(([channel, v]) => ({ value: channel, ...v })).sort((a, b) => b.visits - a.visits),
    vitals: vitals.results[0],
    previousVitals: prevVitals.results[0],
  });
});

// Overview: every site the user can see, with totals, comparison and a short series.
reads.get("/summary", async (c) => {
  const p = parsePeriod(c);
  if (p instanceof Response) return p;
  const db = c.env.DB;
  const tz = timeZoneOf(c.env);
  const allowed = await allowedSites(c.env, c.get("user")!);
  const { results: all } = await db.prepare(`SELECT site_tag, host FROM sites WHERE active = 1 ORDER BY host`)
    .all<{ site_tag: string; host: string }>();
  const sites = allowed ? all.filter((s) => allowed.has(s.site_tag)) : all;
  const hourly = p.days <= 2;
  const w = compareWindow(p, tz, await lastCollection(db));
  const range = {
    ...p, prevFrom: w.prevFrom, prevTo: w.prevTo, unit: hourly ? "hour" : "day",
  };
  if (!sites.length) return c.json({ range: { ...range, partialCompare: false }, sites: [] });

  const tags = sites.map((s) => s.site_tag);
  const [cur, prev, series, prevSeries] = await db.batch<any>([
    db.prepare(`SELECT site_tag, ${sum("pageviews")} AS pageviews, ${sum("visits")} AS visits FROM rum_daily
      WHERE site_tag IN (SELECT value FROM json_each(?1)) AND day BETWEEN ?2 AND ?3 GROUP BY site_tag`)
      .bind(JSON.stringify(tags), p.from, p.to),
    previousTotalsStmt(db, tags, w),
    seriesStmt(db, tags, p.from, p.to, hourly, tz),
    seriesStmt(db, tags, w.prevFrom, w.prevTo, hourly, tz),
  ]);

  const curBy = new Map<string, any>(cur.results.map((r: any) => [r.site_tag, r]));
  const prevBy = new Map<string, any>(prev.results.map((r: any) => [r.site_tag, r]));
  const seriesBy = new Map<string, any[]>();
  for (const r of series.results) seriesBy.set(r.site_tag, [...(seriesBy.get(r.site_tag) ?? []), point(r)]);
  const prevSeriesBy = new Map<string, any[]>();
  for (const r of prevSeries.results) prevSeriesBy.set(r.site_tag, [...(prevSeriesBy.get(r.site_tag) ?? []), point(r)]);

  let partialCompare = false;
  const out = sites.map((s) => {
    const prevRes = resolvePrevious(prevBy.get(s.site_tag), w);
    partialCompare ||= prevRes.partialCompare;
    const cr = curBy.get(s.site_tag);
    return {
      ...s,
      current: { pageviews: cr?.pageviews ?? 0, visits: cr?.visits ?? 0 },
      previous: prevRes.totals,
      series: seriesBy.get(s.site_tag) ?? [],
      previousSeries: prevSeriesBy.get(s.site_tag) ?? [],
      previousCut: previousCut(prevBy.get(s.site_tag), w),
    };
  });
  return c.json({
    range: { ...range, partialCompare, compareUntil: partialCompare ? w.until.toISOString() : null },
    sites: out,
  });
});

reads.get("/top", async (c) => {
  const r = await parseRange(c);
  if (r instanceof Response) return r;
  const dim = c.req.query("dim") as DimKey;
  if (!DIM_KEYS.includes(dim)) return fail(c, 400, "invalid_dim");
  const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
  const { results } = await c.env.DB.prepare(
    `SELECT value, SUM(pageviews) AS pageviews, SUM(visits) AS visits FROM rum_daily_dim
     WHERE site_tag = ?1 AND dim = ?2 AND day BETWEEN ?3 AND ?4
     GROUP BY value ORDER BY ${dim === "ref" ? "visits" : "pageviews"} DESC LIMIT ?5`,
  ).bind(r.site, dim, r.from, r.to, limit).all();
  return c.json({ dim, rows: results });
});

api.route("/", reads);
