import { Hono } from "hono";
import { hashPassword, randomToken, sha256, temporaryPassword } from "../auth/crypto";
import { fail, type AppEnv } from "../auth/session";
import { clearCredentials, deleteSetting, getAccounts, getCredentials, getSetting, putSetting, saveCredentials, verifyToken } from "../settings";
import { collectDay, discoverSites, runHourly, runMaintenance } from "../collector/jobs";
import { TAG_RE } from "../collector/rum";
import { writesToday } from "../db";
import { iterationsOf, num, timeZoneOf } from "../env";
import { addDays, isDay, localDay } from "../time";
import { normEmail } from "./auth";

export const admin = new Hono<AppEnv>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 7;

async function body<T>(c: { req: { json: () => Promise<T> } }): Promise<Partial<T>> {
  try { return (await c.req.json()) ?? {}; } catch { return {}; }
}

const validTags = (tags: unknown): string[] =>
  Array.isArray(tags) ? [...new Set(tags.filter((t): t is string => typeof t === "string" && TAG_RE.test(t)))] : [];

// ---------- Users ----------

admin.get("/users", async (c) => {
  const db = c.env.DB;
  const [users, access, invites] = await db.batch<any>([
    db.prepare(`SELECT id, email, name, role, locale, must_change_password, disabled, created_at FROM users ORDER BY created_at`),
    db.prepare(`SELECT user_id, site_tag FROM user_sites`),
    db.prepare(`SELECT code_hash, email, role, site_tags, created_at, expires_at FROM invites
      WHERE used_at IS NULL ORDER BY created_at DESC`),
  ]);
  const byUser = new Map<string, string[]>();
  for (const r of access.results) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.site_tag]);
  const now = new Date().toISOString();
  return c.json({
    users: users.results.map((u: any) => ({
      id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at,
      mustChangePassword: !!u.must_change_password, disabled: !!u.disabled, sites: byUser.get(u.id) ?? [],
    })),
    invites: invites.results.map((i: any) => ({
      id: i.code_hash, email: i.email, role: i.role, sites: JSON.parse(i.site_tags),
      createdAt: i.created_at, expiresAt: i.expires_at, expired: i.expires_at < now,
    })),
  });
});

admin.post("/invites", async (c) => {
  const b = await body<{ email: string; role: string; sites: string[] }>(c);
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) return fail(c, 400, "invalid_email");
  const role = b.role === "admin" ? "admin" : "member";
  const exists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE email = ?1`).bind(email).first();
  if (exists) return fail(c, 409, "email_taken");
  const code = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
  await c.env.DB.batch([
    // One pending invite per email: the new one replaces the old.
    c.env.DB.prepare(`DELETE FROM invites WHERE email = ?1 AND used_at IS NULL`).bind(email),
    c.env.DB.prepare(`INSERT INTO invites (code_hash, email, role, site_tags, created_by, created_at, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
      .bind(await sha256(code), email, role, JSON.stringify(role === "member" ? validTags(b.sites) : []),
        c.get("user")!.id, now.toISOString(), expires.toISOString()),
  ]);
  const origin = new URL(c.req.url).origin;
  return c.json({ url: `${origin}/invite#${code}`, email, role, expiresAt: expires.toISOString() });
});

admin.delete("/invites/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM invites WHERE code_hash = ?1 AND used_at IS NULL`).bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/** Ensures at least one active admin remains. */
async function otherActiveAdmins(db: D1Database, exceptId: string) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?1`)
    .bind(exceptId).first<number>("n")) ?? 0;
}

admin.patch("/users/:id", async (c) => {
  const id = c.req.param("id");
  const me = c.get("user")!;
  const b = await body<{ role: string; disabled: boolean; sites: string[]; name: string }>(c);
  const target = await c.env.DB.prepare(`SELECT id, role, disabled FROM users WHERE id = ?1`).bind(id).first<any>();
  if (!target) return fail(c, 404, "user_not_found");

  const role = b.role === undefined ? target.role : b.role === "admin" ? "admin" : "member";
  const disabled = b.disabled === undefined ? target.disabled : b.disabled ? 1 : 0;
  const losingAdmin = target.role === "admin" && (role !== "admin" || disabled);
  if (losingAdmin && id === me.id) return fail(c, 400, "cannot_demote_self");
  if (losingAdmin && (await otherActiveAdmins(c.env.DB, id)) === 0) return fail(c, 400, "last_admin");

  const stmts = [
    c.env.DB.prepare(`UPDATE users SET role = ?2, disabled = ?3, name = COALESCE(?4, name) WHERE id = ?1`)
      .bind(id, role, disabled, typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : null),
  ];
  if (disabled) stmts.push(c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id));
  if (role !== "admin" || disabled) {
    stmts.push(c.env.DB.prepare(`DELETE FROM invites WHERE created_by = ?1 AND used_at IS NULL`).bind(id));
  }
  if (b.sites !== undefined) {
    stmts.push(c.env.DB.prepare(`DELETE FROM user_sites WHERE user_id = ?1`).bind(id));
    for (const tag of validTags(b.sites)) {
      stmts.push(c.env.DB.prepare(`INSERT INTO user_sites (user_id, site_tag) VALUES (?1, ?2)`).bind(id, tag));
    }
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

/** Lost password: the admin issues a temporary one, changed at next login. */
admin.post("/users/:id/temporary-password", async (c) => {
  const id = c.req.param("id");
  const exists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE id = ?1`).bind(id).first();
  if (!exists) return fail(c, 404, "user_not_found");
  const password = temporaryPassword();
  const pw = await hashPassword(password, undefined, iterationsOf(c.env));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4, must_change_password = 1 WHERE id = ?1`)
      .bind(id, pw.hash, pw.salt, pw.iterations),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id),
  ]);
  return c.json({ password });
});

admin.delete("/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("user")!.id) return fail(c, 400, "cannot_delete_self");
  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id = ?1`).bind(id).first<string>("role");
  if (!target) return fail(c, 404, "user_not_found");
  if (target === "admin" && (await otherActiveAdmins(c.env.DB, id)) === 0) return fail(c, 400, "last_admin");
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id),
    c.env.DB.prepare(`DELETE FROM user_sites WHERE user_id = ?1`).bind(id),
    c.env.DB.prepare(`DELETE FROM invites WHERE created_by = ?1 AND used_at IS NULL`).bind(id),
    c.env.DB.prepare(`DELETE FROM users WHERE id = ?1`).bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- Cloudflare connection ----------

admin.get("/cloudflare", async (c) => {
  const creds = await getCredentials(c.env).catch(() => null);
  return c.json({ connected: !!creds, accounts: creds ? await getAccounts(c.env) : [] });
});

/** Checks every permission on every account. Saves nothing. */
admin.post("/cloudflare/verify", async (c) => {
  const b = await body<{ token: string }>(c);
  let token = typeof b.token === "string" ? b.token.trim() : "";
  // No new token: revalidate the saved one (e.g. to change the selected accounts).
  if (!token) token = (await getCredentials(c.env))?.token ?? "";
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return fail(c, 400, "invalid_token");
  const r = await verifyToken(token);
  if (!r.ok) return fail(c, 400, r.error);
  return c.json({ accounts: r.accounts });
});

admin.post("/cloudflare/connect", async (c) => {
  const b = await body<{ token: string; accounts: string[] }>(c);
  const newToken = typeof b.token === "string" && b.token.trim() ? b.token.trim() : null;
  const token = newToken ?? (await getCredentials(c.env))?.token;
  if (!token) return fail(c, 400, "invalid_token");
  const r = await verifyToken(token);
  if (!r.ok) return fail(c, 400, r.error);

  const wanted = new Set(validTags(b.accounts));
  const chosen = r.accounts.filter((a) => wanted.has(a.id));
  if (!chosen.length) return fail(c, 400, "no_accounts_selected");
  const missing = chosen.flatMap((a) => [
    ...(a.analytics ? [] : [{ permission: "Account Analytics: Read", account: a.name }]),
    ...(a.settings ? [] : [{ permission: "Account Settings: Read", account: a.name }]),
  ]);
  if (missing.length) return fail(c, 400, "missing_permission", missing);

  await saveCredentials(c.env, newToken, chosen.map((a) => ({ id: a.id, name: a.name })));
  const discovered = await discoverSites(c.env);
  return c.json({ ok: true, discovered });
});

admin.delete("/cloudflare", async (c) => {
  await clearCredentials(c.env);
  return c.json({ ok: true });
});

// ---------- Sites and collection ----------

admin.get("/sites", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.site_tag, s.host, s.account_id, s.active,
       (SELECT MIN(day) FROM rum_daily d WHERE d.site_tag = s.site_tag) AS first_day,
       (SELECT MAX(day) FROM rum_daily d WHERE d.site_tag = s.site_tag) AS last_day
     FROM sites s ORDER BY s.host`,
  ).all();
  return c.json({ sites: results, accounts: await getAccounts(c.env), maxSites: num(c.env.MAX_SITES, 40) });
});

admin.patch("/sites/:tag", async (c) => {
  const tag = c.req.param("tag");
  if (!TAG_RE.test(tag)) return fail(c, 400, "invalid_site");
  const b = await body<{ active: boolean; host: string }>(c);
  await c.env.DB.prepare(`UPDATE sites SET active = COALESCE(?2, active), host = COALESCE(?3, host) WHERE site_tag = ?1`)
    .bind(tag, b.active == null ? null : b.active ? 1 : 0, typeof b.host === "string" && b.host.trim() ? b.host.trim() : null).run();
  return c.json({ ok: true });
});

admin.post("/discover", async (c) => c.json({ upserts: await discoverSites(c.env) }));
admin.post("/run/hourly", async (c) => c.json(await runHourly(c.env)));
admin.post("/run/maintenance", async (c) => c.json(await runMaintenance(c.env)));

// ---------- History import ----------

const JOB_KEY = "backfill_job";
const SLICE = 5;

interface BackfillJob { from: string; to: string; cursor: string; offset: number; total: number; startedAt: string; updatedAt: string }

async function loadJob(env: AppEnv["Bindings"]): Promise<BackfillJob | null> {
  const v = await getSetting(env, JOB_KEY);
  if (!v) return null;
  try { return JSON.parse(v) as BackfillJob; } catch { return null; }
}

const usage = async (env: AppEnv["Bindings"]) => ({
  writesToday: await writesToday(env),
  writeBudget: num(env.DAILY_WRITE_BUDGET, 80_000),
});

admin.get("/backfill", async (c) => c.json({ job: await loadJob(c.env), ...(await usage(c.env)) }));

admin.post("/backfill/start", async (c) => {
  const b = await body<{ days: number }>(c);
  const days = Math.round(Number(b.days));
  if (!Number.isFinite(days) || days < 1 || days > 184) return fail(c, 400, "invalid_days");
  const today = localDay(new Date(), timeZoneOf(c.env));
  const now = new Date().toISOString();
  const job: BackfillJob = {
    from: addDays(today, -days), to: addDays(today, -1), cursor: addDays(today, -days), offset: 0,
    total: days, startedAt: now, updatedAt: now,
  };
  await putSetting(c.env, JOB_KEY, JSON.stringify(job)).run();
  return c.json({ job, ...(await usage(c.env)) });
});

admin.post("/backfill/step", async (c) => {
  const job = await loadJob(c.env);
  if (!job) return fail(c, 404, "no_backfill");
  const day = job.cursor;
  const res = await collectDay(c.env, day, new Date(), { offset: job.offset, limit: SLICE });
  if ("skipped" in res && res.skipped) {
    return c.json({ job, day, written: 0, errors: res.errors ?? [], done: false, skipped: (res as any).reason ?? true, ...(await usage(c.env)) });
  }
  job.offset += SLICE;
  if (job.offset >= res.totalSites) { job.cursor = addDays(day, 1); job.offset = 0; }
  job.updatedAt = new Date().toISOString();
  const done = job.cursor > job.to;
  await (done ? deleteSetting(c.env, JOB_KEY) : putSetting(c.env, JOB_KEY, JSON.stringify(job))).run();
  return c.json({ job: done ? null : job, day, written: res.written, errors: res.errors, done, ...(await usage(c.env)) });
});

admin.delete("/backfill", async (c) => {
  await deleteSetting(c.env, JOB_KEY).run();
  return c.json({ ok: true });
});

admin.get("/status", async (c) => {
  const db = c.env.DB;
  const [runs, size, health] = await db.batch<any>([
    db.prepare(`SELECT job, period, status, detail, ran_at FROM collector_runs ORDER BY ran_at DESC LIMIT 30`),
    db.prepare(`SELECT (SELECT COUNT(*) FROM rum_hourly) AS hourly, (SELECT COUNT(*) FROM rum_daily) AS daily,
      (SELECT COUNT(*) FROM rum_daily_dim) AS dims, (SELECT COUNT(*) FROM rum_daily_vitals) AS vitals`),
    // A stopped cron writes nothing, so report the last attempt as well as the last success.
    db.prepare(`SELECT EXISTS (SELECT 1 FROM settings WHERE key = 'cf_token') AS connected,
      (SELECT MAX(ran_at) FROM collector_runs WHERE job = 'hourly' AND status = 'ok') AS last_success,
      (SELECT MAX(ran_at) FROM collector_runs WHERE job = 'hourly') AS last_attempt`),
  ]);
  const h = health.results[0] ?? {};
  return c.json({
    runs: runs.results,
    rows: size.results[0],
    connected: !!h.connected,
    lastSuccess: h.last_success ?? null,
    lastAttempt: h.last_attempt ?? null,
    // DB size from D1's query meta; Free allows 500 MB per database.
    dbBytes: typeof health.meta?.size_after === "number" ? health.meta.size_after : null,
    dbLimit: num(c.env.DB_LIMIT_BYTES, 500_000_000),
    writesToday: await writesToday(c.env),
    writeBudget: num(c.env.DAILY_WRITE_BUDGET, 80_000),
  });
});
