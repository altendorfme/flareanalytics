import { num, timeZoneOf, type Env } from "../env";
import { logRun, runBatch, statementsFor, writesToday } from "../db";
import { getCredentials, type CfCredentials } from "../settings";
import { addDays, DAY, dayEndUtc, dayStartUtc, floorHour, HOUR, iso, localDay } from "../time";
import { restList } from "./graphql";
import { fetchSites, TAG_RE, type Site, type Window } from "./rum";

const NOT_CONNECTED = { skipped: true, reason: "not_connected" } as const;

/** Active sites of the selected Cloudflare accounts. */
export async function activeSites(env: Env, accounts: string[]): Promise<Site[]> {
  const { results } = await env.DB.prepare(
    `SELECT site_tag, account_id, host FROM sites
     WHERE active = 1 AND account_id IN (SELECT value FROM json_each(?1))
     ORDER BY created_at, site_tag LIMIT ?2`,
  ).bind(JSON.stringify(accounts), num(env.MAX_SITES, 40)).all<Site>();
  return results;
}

/** Discovers Web Analytics sites per selected account and updates `sites`. */
export async function discoverSites(env: Env, creds?: CfCredentials | null): Promise<number> {
  creds ??= await getCredentials(env);
  if (!creds) return 0;
  const stmts: D1PreparedStatement[] = [];
  for (const accountId of creds.accounts) {
    if (!TAG_RE.test(accountId)) continue;
    let sites: any[] = [];
    try {
      sites = await restList<any>(creds.token, `/accounts/${accountId}/rum/site_info/list`, 100);
    } catch (e) {
      console.warn(`descoberta falhou na conta ${accountId}:`, String(e));
      continue;
    }
    for (const s of sites) {
      if (!TAG_RE.test(s.site_tag)) continue;
      const host = s.ruleset?.zone_name || s.host || s.site_tag;
      stmts.push(env.DB.prepare(
        `INSERT INTO sites (site_tag, account_id, host) VALUES (?1, ?2, ?3)
         ON CONFLICT (site_tag) DO UPDATE SET account_id = excluded.account_id, host = excluded.host
         WHERE account_id <> excluded.account_id OR host <> excluded.host`,
      ).bind(s.site_tag, accountId, host));
    }
  }
  if (stmts.length) await runBatch(env, stmts);
  return stmts.length;
}

/** Collects a period: one GraphQL query per group of same-account sites. */
async function collect(env: Env, token: string, sites: Site[], w: Window, day: string, prune: boolean) {
  const perQuery = Math.max(1, num(env.SITES_PER_QUERY, 5));
  const byAccount = new Map<string, Site[]>();
  for (const s of sites) byAccount.set(s.account_id, [...(byAccount.get(s.account_id) ?? []), s]);

  let written = 0;
  const errors: string[] = [];
  for (const [accountId, list] of byAccount) {
    for (let i = 0; i < list.length; i += perQuery) {
      const group = list.slice(i, i + perQuery);
      try {
        const results = await fetchSites(token, accountId, group, w);
        written += await runBatch(env, results.flatMap((r) => statementsFor(env, r, day, prune)));
      } catch (e) {
        errors.push(`${accountId}: ${String(e).slice(0, 300)}`);
      }
    }
  }
  return { written, errors, sites: sites.length };
}

/** Hourly cron: today's closed hours plus totals/tops/vitals for today so far. */
export async function runHourly(env: Env, now = new Date()) {
  const creds = await getCredentials(env);
  if (!creds) return NOT_CONNECTED;
  const tz = timeZoneOf(env);
  let sites = await activeSites(env, creds.accounts);
  if (!sites.length) {
    await discoverSites(env, creds);
    sites = await activeSites(env, creds.accounts);
  }
  const H = floorHour(now);
  const today = localDay(now, tz);
  const withDims = (await writesToday(env)) < num(env.DAILY_WRITE_BUDGET, 80_000);

  // The series covers the whole local day (at least 3 hours, to close the day boundary),
  // so missed hours fill in; unchanged rows aren't rewritten.
  const dayStart = dayStartUtc(today, tz);
  const hoursStart = new Date(Math.min(dayStart.getTime(), H.getTime() - 3 * HOUR));
  const res = await collect(env, creds.token, sites, {
    dayStart,
    dayEnd: now,
    hoursStart,
    hoursEnd: H,
    withDims,
  }, today, true);

  await logRun(env, "hourly", iso(H), res.errors.length ? "error" : "ok", { ...res, withDims });
  return { ...res, withDims };
}

/** Collects the final version of a closed local day (day close and backfill). */
export async function collectDay(env: Env, day: string, now = new Date(), slice?: { offset: number; limit: number }) {
  const creds = await getCredentials(env);
  if (!creds) return { ...NOT_CONNECTED, written: 0, errors: [], sites: 0, totalSites: 0 };
  const tz = timeZoneOf(env);
  const start = dayStartUtc(day, tz);
  const end = dayEndUtc(day, tz);
  if (end > now) throw new Error(`o dia ${day} ainda não terminou`);
  if ((await writesToday(env)) >= num(env.DAILY_WRITE_BUDGET, 80_000)) {
    return { skipped: true, reason: "write_budget", written: 0, errors: [] as string[], sites: 0, totalSites: 0 };
  }
  const retentionStart = now.getTime() - num(env.HOURLY_RETENTION_DAYS, 30) * DAY;
  const withHours = end.getTime() > retentionStart;
  const all = await activeSites(env, creds.accounts);
  const sites = slice ? all.slice(slice.offset, slice.offset + slice.limit) : all;
  const res = await collect(env, creds.token, sites, {
    dayStart: start,
    dayEnd: end,
    hoursStart: withHours ? start : undefined,
    hoursEnd: withHours ? end : undefined,
    withDims: true,
  }, day, true);
  // Sliced backfill doesn't mark the day closed; the maintenance cron does.
  if (!slice) await logRun(env, "close", day, res.errors.length ? "error" : "ok", res);
  return { ...res, totalSites: all.length };
}

/**
 * Maintenance cron: if yesterday isn't closed, discover sites, store yesterday's final version
 * and clean up. Otherwise it costs one read.
 */
export async function runMaintenance(env: Env, now = new Date()) {
  const yesterday = addDays(localDay(now, timeZoneOf(env)), -1);
  const done = await env.DB.prepare(`SELECT status FROM collector_runs WHERE job = 'close' AND period = ?1`)
    .bind(yesterday).first<string>("status");
  if (done === "ok") return { skipped: true, day: yesterday };

  const creds = await getCredentials(env);
  if (!creds) return NOT_CONNECTED;
  const discovered = await discoverSites(env, creds);
  const res = await collectDay(env, yesterday, now);

  const nowIso = now.toISOString();
  const cutoff = iso(new Date(floorHour(now).getTime() - num(env.HOURLY_RETENTION_DAYS, 30) * DAY));
  const oldCounters = `writes:${addDays(nowIso.slice(0, 10), -7)}`;
  const oldInvites = new Date(now.getTime() - 30 * DAY).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM rum_hourly WHERE hour < ?1`).bind(cutoff),
    env.DB.prepare(`DELETE FROM counters WHERE key LIKE 'writes:%' AND key < ?1`).bind(oldCounters),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(nowIso),
    env.DB.prepare(`DELETE FROM invites WHERE expires_at < ?1`).bind(oldInvites),
  ]);
  return { day: yesterday, discovered, ...res };
}
