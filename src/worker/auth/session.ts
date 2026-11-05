import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { randomToken, sha256 } from "./crypto";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  locale: string | null;
  must_change_password: number;
  pw_hash: string;
  pw_salt: string;
  pw_iter: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: User | null; sessionHash: string | null } };

const COOKIE = "fa_session";
const SESSION_DAYS = 30;

/** API error with a stable code that the client translates. */
export const fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 500, error: string, detail?: unknown) =>
  c.json({ error, ...(detail !== undefined ? { detail } : {}) }, status);

export const publicUser = (u: User) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, locale: u.locale,
  mustChangePassword: !!u.must_change_password,
});

export async function createSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await c.env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)`)
    .bind(await sha256(token), userId, expires.toISOString()).run();
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires,
  });
}

export async function destroySession(c: Context<AppEnv>) {
  const hash = c.get("sessionHash");
  if (hash) await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(hash).run();
  deleteCookie(c, COOKIE, { path: "/", secure: true });
}

/** Loads the session user, if any. Blocks nothing. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  c.set("sessionHash", null);
  const token = getCookie(c, COOKIE);
  if (token && token.length <= 64) {
    const hash = await sha256(token);
    const user = await c.env.DB.prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.disabled = 0`,
    ).bind(hash, new Date().toISOString()).first<User>();
    if (user) {
      c.set("user", user);
      c.set("sessionHash", hash);
    }
  }
  await next();
};

/** CSRF guard: state-changing requests must be same-origin. */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    let same = false;
    try { same = new URL(c.req.header("origin") ?? "").origin === new URL(c.req.url).origin; } catch { /* invalid */ }
    if (!same) return fail(c, 403, "bad_origin");
  }
  await next();
};

/** Requires login. With a pending password change, only account routes are allowed. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return fail(c, 401, "unauthorized");
  if (user.must_change_password) return fail(c, 403, "password_change_required");
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return fail(c, 401, "unauthorized");
  if (user.must_change_password) return fail(c, 403, "password_change_required");
  if (user.role !== "admin") return fail(c, 403, "forbidden");
  await next();
};

/** Sites visible to the user: null = all (admin). */
export async function allowedSites(env: Env, user: User): Promise<Set<string> | null> {
  if (user.role === "admin") return null;
  const { results } = await env.DB.prepare(`SELECT site_tag FROM user_sites WHERE user_id = ?1`)
    .bind(user.id).all<{ site_tag: string }>();
  return new Set(results.map((r) => r.site_tag));
}

/** Rate limits login, setup and invites. No-op without the binding. */
export async function rateLimited(c: Context<AppEnv>, scope: string, subject = "") {
  const limiter = c.env.LOGIN_LIMITER;
  if (!limiter) return false;
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  const { success } = await limiter.limit({ key: `${scope}:${ip}:${subject.toLowerCase()}` });
  return !success;
}
