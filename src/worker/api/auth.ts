import { Hono } from "hono";
import { hashPassword, safeEqual, sha256, verifyPassword } from "../auth/crypto";
import {
  createSession, destroySession, fail, publicUser, rateLimited, type AppEnv, type User,
} from "../auth/session";
import { getCredentials } from "../settings";
import { iterationsOf } from "../env";

export const auth = new Hono<AppEnv>();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const APP_KEY_PLACEHOLDER = "replace-with-a-long-random-secret";
const DUMMY_PW = { pw_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", pw_salt: "AAAAAAAAAAAAAAAAAAAAAA" };
export const LOCALES = ["en", "pt-BR"] as const;
const validLocale = (l: unknown) => (LOCALES as readonly string[]).includes(l as string) ? (l as string) : null;
const validPassword = (p: unknown): p is string => typeof p === "string" && p.length >= 10 && p.length <= 200;
const cleanName = (n: unknown) => (typeof n === "string" ? n.trim().slice(0, 80) : "");
export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");

async function body<T>(c: { req: { json: () => Promise<T> } }): Promise<Partial<T>> {
  try { return (await c.req.json()) ?? {}; } catch { return {}; }
}

export async function insertUser(
  db: D1Database, iterations: number, data: { email: string; name: string; password: string; role: "admin" | "member"; locale: string | null; mustChange?: boolean },
) {
  const id = crypto.randomUUID();
  const pw = await hashPassword(data.password, undefined, iterations);
  const stmt = db.prepare(
    `INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, role, locale, must_change_password, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(id, data.email, data.name, pw.hash, pw.salt, pw.iterations, data.role, data.locale, data.mustChange ? 1 : 0, new Date().toISOString());
  return { id, stmt };
}

/** Public: the client picks /setup or /login. */
auth.get("/status", async (c) => {
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<number>("n");
  return c.json({ needsSetup: !n });
});

/** First run: creates the admin. Requires APP_KEY. */
auth.post("/setup", async (c) => {
  if (await rateLimited(c, "setup")) return fail(c, 429, "too_many_attempts");
  const b = await body<{ appKey: string; email: string; name: string; password: string; locale: string }>(c);
  const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<number>("n");
  if (n) return fail(c, 409, "setup_done");
  if (!c.env.APP_KEY || c.env.APP_KEY.length < 16) return fail(c, 500, "app_key_missing");
  if (c.env.APP_KEY.trim() === APP_KEY_PLACEHOLDER) return fail(c, 500, "app_key_placeholder");
  if (typeof b.appKey !== "string" || !(await safeEqual(b.appKey, c.env.APP_KEY))) return fail(c, 403, "invalid_app_key");
  const email = normEmail(b.email);
  if (!EMAIL_RE.test(email)) return fail(c, 400, "invalid_email");
  if (!validPassword(b.password)) return fail(c, 400, "weak_password");
  const name = cleanName(b.name) || email.split("@")[0];
  const { id, stmt } = await insertUser(c.env.DB, iterationsOf(c.env), { email, name, password: b.password, role: "admin", locale: validLocale(b.locale) });
  await stmt.run();
  await createSession(c, id);
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<User>();
  return c.json({ user: publicUser(user!), connected: false });
});

auth.post("/login", async (c) => {
  const b = await body<{ email: string; password: string }>(c);
  const email = normEmail(b.email);
  if (await rateLimited(c, "login", email)) return fail(c, 429, "too_many_attempts");
  if (!email || typeof b.password !== "string" || b.password.length > 200) return fail(c, 401, "invalid_credentials");
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?1 AND disabled = 0`).bind(email).first<User>();
  const ok = await verifyPassword(b.password, user ?? { ...DUMMY_PW, pw_iter: iterationsOf(c.env) });
  if (!user || !ok) return fail(c, 401, "invalid_credentials");
  await createSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post("/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

auth.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return fail(c, 401, "unauthorized");
  const connected = user.role === "admin" ? !!(await getCredentials(c.env).catch(() => null)) : undefined;
  return c.json({ user: publicUser(user), connected });
});

auth.patch("/me", async (c) => {
  const user = c.get("user");
  if (!user) return fail(c, 401, "unauthorized");
  const b = await body<{ locale: string; name: string }>(c);
  const locale = b.locale === undefined ? user.locale : validLocale(b.locale);
  const name = b.name === undefined ? user.name : cleanName(b.name) || user.name;
  await c.env.DB.prepare(`UPDATE users SET locale = ?2, name = ?3 WHERE id = ?1`).bind(user.id, locale, name).run();
  return c.json({ user: publicUser({ ...user, locale, name }) });
});

/** Also handles the forced change after a temporary password. */
auth.post("/change-password", async (c) => {
  const user = c.get("user");
  if (!user) return fail(c, 401, "unauthorized");
  if (await rateLimited(c, "change-password", user.id)) return fail(c, 429, "too_many_attempts");
  const b = await body<{ current: string; password: string }>(c);
  if (typeof b.current !== "string" || !(await verifyPassword(b.current, user))) return fail(c, 400, "invalid_current_password");
  if (!validPassword(b.password)) return fail(c, 400, "weak_password");
  if (b.password === b.current) return fail(c, 400, "same_password");
  const pw = await hashPassword(b.password, undefined, iterationsOf(c.env));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET pw_hash = ?2, pw_salt = ?3, pw_iter = ?4, must_change_password = 0 WHERE id = ?1`)
      .bind(user.id, pw.hash, pw.salt, pw.iterations),
    // End the user's other sessions.
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1 AND token_hash <> ?2`).bind(user.id, c.get("sessionHash") ?? ""),
  ]);
  return c.json({ user: publicUser({ ...user, must_change_password: 0 }) });
});

// ---------- Invites ----------

async function findInvite(db: D1Database, code: unknown) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  return db.prepare(
    `SELECT i.* FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.code_hash = ?1 AND u.role = 'admin' AND u.disabled = 0`,
  ).bind(await sha256(code))
    .first<{ code_hash: string; email: string; role: "admin" | "member"; site_tags: string; expires_at: string; used_at: string | null }>();
}

auth.post("/invite/info", async (c) => {
  if (await rateLimited(c, "invite")) return fail(c, 429, "too_many_attempts");
  const b = await body<{ code: string }>(c);
  const inv = await findInvite(c.env.DB, b.code);
  if (!inv) return fail(c, 404, "invite_not_found");
  if (inv.used_at) return fail(c, 409, "invite_used");
  if (inv.expires_at < new Date().toISOString()) return fail(c, 409, "invite_expired");
  return c.json({ email: inv.email, role: inv.role });
});

auth.post("/invite/accept", async (c) => {
  if (await rateLimited(c, "invite")) return fail(c, 429, "too_many_attempts");
  const b = await body<{ code: string; name: string; password: string; locale: string }>(c);
  const inv = await findInvite(c.env.DB, b.code);
  if (!inv) return fail(c, 404, "invite_not_found");
  if (inv.used_at) return fail(c, 409, "invite_used");
  if (inv.expires_at < new Date().toISOString()) return fail(c, 409, "invite_expired");
  if (!validPassword(b.password)) return fail(c, 400, "weak_password");
  const exists = await c.env.DB.prepare(`SELECT 1 FROM users WHERE email = ?1`).bind(inv.email).first();
  if (exists) return fail(c, 409, "email_taken");

  const name = cleanName(b.name) || inv.email.split("@")[0];
  const { id, stmt } = await insertUser(c.env.DB, iterationsOf(c.env), { email: inv.email, name, password: b.password, role: inv.role, locale: validLocale(b.locale) });
  const sites: string[] = inv.role === "member" ? JSON.parse(inv.site_tags) : [];
  await c.env.DB.batch([
    stmt,
    // Mark used only if still unused (two tabs can race).
    c.env.DB.prepare(`UPDATE invites SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL`).bind(inv.code_hash, new Date().toISOString()),
    ...sites.map((tag) => c.env.DB.prepare(`INSERT OR IGNORE INTO user_sites (user_id, site_tag) VALUES (?1, ?2)`).bind(id, tag)),
  ]);
  await createSession(c, id);
  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?1`).bind(id).first<User>();
  return c.json({ user: publicUser(user!) });
});
