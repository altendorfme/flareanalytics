import type { Env } from "./env";
import { DIM_KEYS, type SiteResult } from "./collector/rum";

// Upserts only rewrite changed rows (WHERE in DO UPDATE); unchanged rows don't count toward
// the D1 Free quota of 100k writes/day.

const UPSERT_HOURLY = `INSERT INTO rum_hourly (site_tag, hour, pageviews, visits) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (site_tag, hour) DO UPDATE SET pageviews = excluded.pageviews, visits = excluded.visits
  WHERE pageviews <> excluded.pageviews OR visits <> excluded.visits`;

const UPSERT_DAILY = `INSERT INTO rum_daily (site_tag, day, pageviews, visits) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (site_tag, day) DO UPDATE SET pageviews = excluded.pageviews, visits = excluded.visits
  WHERE pageviews <> excluded.pageviews OR visits <> excluded.visits`;

const UPSERT_DIM = `INSERT INTO rum_daily_dim (site_tag, dim, day, value, pageviews, visits) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  ON CONFLICT (site_tag, dim, day, value) DO UPDATE SET pageviews = excluded.pageviews, visits = excluded.visits
  WHERE pageviews <> excluded.pageviews OR visits <> excluded.visits`;

// On day close, drop values that fell out of the final top-N.
const PRUNE_DIM = `DELETE FROM rum_daily_dim WHERE site_tag = ?1 AND dim = ?2 AND day = ?3
  AND value NOT IN (SELECT value FROM json_each(?4))`;

const VITAL_COLS = [
  "lcp_p75", "inp_p75", "cls_p75", "fcp_p75", "ttfb_p75",
  "lcp_good", "lcp_poor", "lcp_total", "inp_good", "inp_poor", "inp_total",
  "cls_good", "cls_poor", "cls_total", "fcp_good", "fcp_poor", "fcp_total",
  "ttfb_good", "ttfb_poor", "ttfb_total",
] as const;

const UPSERT_VITALS = `INSERT INTO rum_daily_vitals (site_tag, day, ${VITAL_COLS.join(", ")})
  VALUES (?1, ?2, ${VITAL_COLS.map((_, i) => `?${i + 3}`).join(", ")})
  ON CONFLICT (site_tag, day) DO UPDATE SET ${VITAL_COLS.map((c) => `${c} = excluded.${c}`).join(", ")}
  WHERE ${["lcp_total", "inp_total", "cls_total", "fcp_total", "ttfb_total", "lcp_p75", "inp_p75"]
    .map((c) => `${c} IS NOT excluded.${c}`).join(" OR ")}`;

export function statementsFor(env: Env, r: SiteResult, day: string, final: boolean): D1PreparedStatement[] {
  const db = env.DB;
  const out: D1PreparedStatement[] = [];
  for (const h of r.hours) out.push(db.prepare(UPSERT_HOURLY).bind(r.site_tag, h.hour, h.pageviews, h.visits));
  out.push(db.prepare(UPSERT_DAILY).bind(r.site_tag, day, r.totals.pageviews, r.totals.visits));
  if (r.dims) {
    for (const dim of DIM_KEYS) {
      const rows = r.dims[dim];
      for (const row of rows) {
        out.push(db.prepare(UPSERT_DIM).bind(r.site_tag, dim, day, row.value, row.pageviews, row.visits));
      }
      if (final) out.push(db.prepare(PRUNE_DIM).bind(r.site_tag, dim, day, JSON.stringify(rows.map((x) => x.value))));
    }
  }
  if (r.vitals && r.vitals.lcp_total + r.vitals.fcp_total + r.vitals.ttfb_total > 0) {
    const v = r.vitals;
    out.push(db.prepare(UPSERT_VITALS).bind(r.site_tag, day, ...VITAL_COLS.map((c) => v[c])));
  }
  return out;
}

const utcDate = () => new Date().toISOString().slice(0, 10);

/** Runs in batches (each counts as one query) and tallies writes. */
export async function runBatch(env: Env, stmts: D1PreparedStatement[], chunk = 400): Promise<number> {
  let written = 0;
  for (let i = 0; i < stmts.length; i += chunk) {
    const results = await env.DB.batch(stmts.slice(i, i + chunk));
    for (const r of results) written += r.meta?.rows_written ?? 0;
  }
  if (written > 0) await addCounter(env, `writes:${utcDate()}`, written);
  return written;
}

export async function addCounter(env: Env, key: string, n: number) {
  await env.DB.prepare(
    `INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = value + excluded.value`,
  ).bind(key, n).run();
}

/** Rows written today (UTC, same reset as the D1 quota). */
export async function writesToday(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT value FROM counters WHERE key = ?1`).bind(`writes:${utcDate()}`).first<number>("value");
  return r ?? 0;
}

export async function logRun(env: Env, job: string, period: string, status: "ok" | "error", detail: unknown) {
  await env.DB.prepare(
    `INSERT INTO collector_runs (job, period, status, detail, ran_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (job, period) DO UPDATE SET status = excluded.status, detail = excluded.detail, ran_at = excluded.ran_at`,
  ).bind(job, period, status, JSON.stringify(detail).slice(0, 2000), new Date().toISOString()).run();
}
