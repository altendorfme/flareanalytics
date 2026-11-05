import { isTimeZone } from "../shared/tz";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Authorizes initial setup and encrypts the Cloudflare token in D1. */
  APP_KEY: string;
  /** Optional rate limit for login, setup and invites. */
  LOGIN_LIMITER?: RateLimit;
  /** IANA time zone used to split days (e.g. America/Sao_Paulo, UTC). */
  TIMEZONE?: string;
  MAX_SITES: string;
  SITES_PER_QUERY: string;
  DAILY_WRITE_BUDGET: string;
  /** Optional max DB size in bytes (default 500 MB, D1 Free). */
  DB_LIMIT_BYTES?: string;
  HOURLY_RETENTION_DAYS: string;
  /** Max 100000 on Workers; 50000 fits the Free plan's 10 ms CPU limit. */
  PBKDF2_ITERATIONS: string;
}

export const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

export function timeZoneOf(env: Env) {
  const tz = env.TIMEZONE?.trim() || "America/Sao_Paulo";
  if (!isTimeZone(tz)) throw new RangeError(`TIMEZONE inválido: "${tz}" (use um fuso IANA, ex.: America/Sao_Paulo ou UTC)`);
  return tz;
}
export const iterationsOf = (env: Env) => Math.min(100_000, Math.max(10_000, num(env.PBKDF2_ITERATIONS, 50_000)));
