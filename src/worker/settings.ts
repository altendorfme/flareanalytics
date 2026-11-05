import type { Env } from "./env";
import { decryptSecret, encryptSecret } from "./auth/crypto";
import { cfFetch, CfHttpError, gql, restList } from "./collector/graphql";
import { TAG_RE } from "./collector/rum";

export interface CfCredentials { token: string; accounts: string[] }

async function getSetting(env: Env, key: string) {
  return env.DB.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(key).first<string>("value");
}

const putSetting = (env: Env, key: string, value: string) =>
  env.DB.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .bind(key, value);

/** Decrypted token and selected accounts, or null if Cloudflare isn't connected. */
export async function getCredentials(env: Env): Promise<CfCredentials | null> {
  const [enc, accounts] = await Promise.all([getSetting(env, "cf_token"), getSetting(env, "cf_accounts")]);
  if (!enc) return null;
  const token = await decryptSecret(env.APP_KEY, enc);
  return { token, accounts: accounts ? JSON.parse(accounts) : [] };
}

export async function getAccounts(env: Env): Promise<{ id: string; name: string }[]> {
  const v = await getSetting(env, "cf_accounts_meta");
  return v ? JSON.parse(v) : [];
}

export async function saveCredentials(env: Env, token: string | null, accounts: { id: string; name: string }[]) {
  const stmts = [
    putSetting(env, "cf_accounts", JSON.stringify(accounts.map((a) => a.id))),
    putSetting(env, "cf_accounts_meta", JSON.stringify(accounts)),
  ];
  if (token) stmts.push(putSetting(env, "cf_token", await encryptSecret(env.APP_KEY, token)));
  await env.DB.batch(stmts);
}

export async function clearCredentials(env: Env) {
  await env.DB.prepare(`DELETE FROM settings WHERE key IN ('cf_token', 'cf_accounts', 'cf_accounts_meta')`).run();
}

// ---------- Token validation ----------

export interface AccountCheck {
  id: string;
  name: string;
  analytics: boolean;
  settings: boolean;
  sites: { site_tag: string; host: string }[];
}

export type VerifyResult =
  | { ok: true; accounts: AccountCheck[] }
  | { ok: false; error: "invalid_token" | "inactive_token" | "no_accounts" };

const isAuthError = (e: unknown) => e instanceof CfHttpError && (e.status === 401 || e.status === 403);

export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const v = await cfFetch(token, "/user/tokens/verify");
    if (v.result?.status !== "active") return { ok: false, error: "inactive_token" };
  } catch (e) {
    if (e instanceof CfHttpError && e.status < 500) return { ok: false, error: "invalid_token" };
    throw e;
  }

  let accounts: { id: string; name: string }[] = [];
  try {
    accounts = await restList<{ id: string; name: string }>(token, "/accounts");
  } catch (e) {
    if (!isAuthError(e)) throw e;
  }
  if (!accounts.length) return { ok: false, error: "no_accounts" };

  const end = new Date();
  const start = new Date(end.getTime() - 3_600_000);
  const checks = await Promise.all(accounts.filter((a) => TAG_RE.test(a.id)).map(async (a): Promise<AccountCheck> => {
    const check: AccountCheck = { id: a.id, name: a.name, analytics: false, settings: false, sites: [] };
    try {
      const sites = await restList<any>(token, `/accounts/${a.id}/rum/site_info/list`, 100);
      check.settings = true;
      check.sites = sites
        .filter((s) => TAG_RE.test(s.site_tag))
        .map((s) => ({ site_tag: s.site_tag, host: s.ruleset?.zone_name || s.host || s.site_tag }));
    } catch (e) {
      if (!isAuthError(e)) throw e;
    }
    try {
      await gql(token, `{ viewer { accounts(filter:{accountTag:"${a.id}"}) {
        rumPageloadEventsAdaptiveGroups(limit:1, filter:{datetime_geq:"${start.toISOString()}", datetime_lt:"${end.toISOString()}"}) { count } } } }`);
      check.analytics = true;
    } catch (e) {
      if (!isAuthError(e) && !/not authorized|access|permission/i.test(String(e))) throw e;
    }
    return check;
  }));
  return { ok: true, accounts: checks };
}
