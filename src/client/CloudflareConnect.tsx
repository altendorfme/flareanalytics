import { useState } from "react";
import { IconCheck, IconExternalLink, IconX } from "@tabler/icons-react";
import { ApiError, post } from "./api";
import { useI18n } from "./i18n";
import { TOKEN_TEMPLATE_URL } from "./format";
import { Button, buttonCls, checkboxCls, cn, hintCls, inputCls, labelCls, Notice } from "./ui";

interface AccountCheck {
  id: string; name: string; analytics: boolean; settings: boolean; sites: { site_tag: string; host: string }[];
}

const codeCls = "rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono text-sm";

/** Token instructions: required permissions plus a prefilled link. */
export function TokenGuide() {
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4" aria-labelledby="guide-title">
      <h3 id="guide-title" className="text-base font-semibold">{t("cf.guideTitle")}</h3>
      <p>{t("cf.guideLead")}</p>
      <ul className="flex flex-col gap-2 text-md">
        <li><code className={codeCls}>{t("cf.permAnalytics")}</code>: <span className="text-ink-2">{t("cf.permAnalyticsWhy")}</span></li>
        <li><code className={codeCls}>{t("cf.permSettings")}</code>: <span className="text-ink-2">{t("cf.permSettingsWhy")}</span></li>
      </ul>
      <a className={cn(buttonCls(), "self-start")} href={TOKEN_TEMPLATE_URL} target="_blank" rel="noopener noreferrer">
        {t("cf.openTemplate")} <IconExternalLink size={18} aria-hidden="true" />
      </a>
    </section>
  );
}

/**
 * Paste token → check each permission per account → pick accounts → save.
 * Without `requireToken`, reuses the saved token to change accounts only.
 */
export function CloudflareConnect({ onDone, requireToken = true, initialAccounts = [] }: {
  onDone: (discovered: number) => void; requireToken?: boolean; initialAccounts?: string[];
}) {
  const { t, te } = useI18n();
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<AccountCheck[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(initialAccounts));
  const [busy, setBusy] = useState<"verify" | "connect" | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const show = (e: unknown) => {
    if (e instanceof ApiError && e.code === "missing_permission" && Array.isArray(e.detail)) {
      setErrors(e.detail.map((d: any) => te("missing_permission", d)));
    } else setErrors([te(e instanceof ApiError ? e.code : "generic")]);
  };

  const verify = async () => {
    setBusy("verify"); setErrors([]); setAccounts(null);
    try {
      const r = await post<{ accounts: AccountCheck[] }>("/api/admin/cloudflare/verify", { token });
      setAccounts(r.accounts);
      // Preselect accounts with full permissions and sites, or the ones chosen before.
      setChosen(new Set(initialAccounts.length ? initialAccounts
        : r.accounts.filter((a) => a.analytics && a.settings && a.sites.length).map((a) => a.id)));
    } catch (e) { show(e); } finally { setBusy(null); }
  };

  const connect = async () => {
    setBusy("connect"); setErrors([]);
    try {
      const r = await post<{ discovered: number }>("/api/admin/cloudflare/connect", { token, accounts: [...chosen] });
      onDone(r.discovered);
    } catch (e) { show(e); } finally { setBusy(null); }
  };

  const toggle = (id: string) => setChosen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="flex flex-col gap-4">
      {requireToken && <TokenGuide />}
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
        {requireToken && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="cf-token" className={labelCls}>{t("cf.tokenLabel")}</label>
            <div className="flex gap-2">
              <input id="cf-token" type="password" autoComplete="off" spellCheck={false} className={cn(inputCls, "min-w-0 flex-1 font-mono text-sm")}
                placeholder={t("cf.tokenPlaceholder")} value={token} onChange={(e) => setToken(e.target.value.trim())}
                aria-describedby="cf-token-hint" required />
              <Button type="submit" busy={busy === "verify"} disabled={token.length < 20}>
                {busy === "verify" ? t("cf.verifying") : t("cf.verify")}
              </Button>
            </div>
            <p id="cf-token-hint" className={hintCls}>{t("cf.tokenStored")}</p>
          </div>
        )}
        {!requireToken && !accounts && (
          <div><Button type="submit" busy={busy === "verify"}>{busy === "verify" ? t("cf.verifying") : t("cf.changeAccounts")}</Button></div>
        )}
      </form>

      {errors.length > 0 && <Notice tone="error">{errors.map((m) => <p key={m}>{m}</p>)}</Notice>}

      {accounts && (
        <fieldset className="m-0 flex flex-col gap-1 rounded-lg border border-border px-4 pt-2 pb-4">
          <legend className="px-1.5 text-md font-semibold">{t("cf.accountsTitle")}</legend>
          {accounts.map((a) => {
            const ok = a.analytics && a.settings;
            return (
              <label key={a.id} className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 border-b border-grid py-2.5 last-of-type:border-b-0">
                <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} className={checkboxCls} />
                <span className={cn("font-semibold", !ok && "text-ink-2")}>{a.name}</span>
                <span className="col-start-2 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-muted">
                  <Perm ok={a.analytics} label={t("cf.analyticsOk")} missing={t("cf.missing")} />
                  <Perm ok={a.settings} label={t("cf.settingsOk")} missing={t("cf.missing")} />
                  <span>{a.sites.length === 0 ? t("cf.noSitesFound") : a.sites.length === 1 ? t("cf.oneSiteFound") : t("cf.sitesFound", { count: a.sites.length })}</span>
                </span>
              </label>
            );
          })}
          <div>
            <Button variant="primary" type="button" onClick={connect} busy={busy === "connect"} disabled={!chosen.size}>
              {busy === "connect" ? t("cf.connecting") : t("cf.connect")}
            </Button>
          </div>
        </fieldset>
      )}
    </div>
  );
}

function Perm({ ok, label, missing }: { ok: boolean; label: string; missing: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", ok ? "text-good" : "font-semibold text-danger")}>
      {ok ? <IconCheck size={16} aria-hidden="true" /> : <IconX size={16} aria-hidden="true" />}
      {label}{!ok && <span className="sr-only"> ({missing})</span>}
    </span>
  );
}
