import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { ApiError, del, get, patch, post, type SiteInfo } from "./api";
import { useI18n, type MessageKey } from "./i18n";
import { formatters, isTokenError, nextCollection, runErrors, STALE_MS } from "./format";
import { navigate, onLinkClick } from "./router";
import { useSession } from "./session";
import { useSites } from "./Shell";
import { CloudflareConnect } from "./CloudflareConnect";
import {
  Button, checkboxCls, cn, CopyField, Dialog, emptyCls, Field, hintCls, inputCls, labelCls, Menu, Notice, pageHeadCls, pageTitleCls,
  panelCls, panelTitleCls, selectCls, Spinner, StatusBadge, thCls,
} from "./ui";
import { useTitle } from "./useTitle";
import { Freshness } from "./Dashboard";

const TABS = ["people", "cloudflare", "sites", "history", "status"] as const;

const stackCls = "flex flex-col gap-4";
const rowCls = "flex flex-wrap items-center gap-3";
const narrowPanelCls = cn(panelCls, stackCls, "max-w-[720px]");
const tableCls = "w-full text-md";
const dataThCls = cn(thCls, "border-b border-grid px-2.5 py-3 text-left align-top");
const dataTdCls = "border-b border-grid px-2.5 py-3 align-top [tr:last-child>&]:border-b-0";
/**
 * On mobile each row stacks into a block and each cell shows its column label (data-label)
 * instead of scrolling sideways.
 */
const stackTableCls = "max-xs:block max-xs:[&_thead]:sr-only max-xs:[&_tbody]:block";
const stackTrCls = "max-xs:block max-xs:border-b max-xs:border-grid max-xs:py-3 max-xs:last:border-b-0";
const stackTdCls = cn(
  "max-xs:block max-xs:w-auto max-xs:border-0 max-xs:px-0 max-xs:py-0.5 max-xs:text-left",
  "max-xs:before:mr-2 max-xs:before:text-sm max-xs:before:text-muted max-xs:before:content-[attr(data-label)]",
);
const tagCls = "mt-1.5 mr-1.5 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-sm text-ink-2";
const progressCls = "h-2.5 overflow-hidden rounded-[5px] bg-surface-2";
const progressBarCls = "block h-full origin-left bg-accent transition-transform duration-300 ease-out-soft";
type Tab = (typeof TABS)[number];

/** The last successful hourly collection is older than the stale threshold. */
function useCollectionLate() {
  const { lastRun } = useSites();
  return lastRun != null && Date.now() - Date.parse(lastRun) > STALE_MS;
}

export function SettingsPage({ tab }: { tab: string }) {
  const { t } = useI18n();
  const late = useCollectionLate();
  // Plain /settings opens where the trouble is while collection is late.
  const current: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : late ? "status" : "people";
  useTitle(t(`settings.${current}` as MessageKey), t("settings.title"));
  return (
    <>
      <header className={pageHeadCls}><h1 className={pageTitleCls}>{t("settings.title")}</h1></header>
      {/* Five tabs don't fit at 390px, so mobile gets a native select. */}
      <label className="mb-5 hidden max-xs:block">
        <span className="sr-only">{t("settings.section")}</span>
        <select className={cn(selectCls, "w-full font-medium")} value={current} onChange={(e) => navigate(`/settings/${e.target.value}`)}>
          {TABS.map((k) => <option key={k} value={k}>{t(`settings.${k}` as MessageKey)}{k === "status" && late ? ` · ${t("settings.lateBadge")}` : ""}</option>)}
        </select>
      </label>
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] max-xs:hidden" aria-label={t("settings.title")}>
        {TABS.map((k) => (
          <a key={k} href={`/settings/${k}`} onClick={onLinkClick} aria-current={current === k ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2.5 text-md whitespace-nowrap no-underline",
              current === k ? "border-accent font-semibold text-accent hover:text-accent" : "border-transparent font-medium text-ink-2 hover:text-ink",
            )}>
            {t(`settings.${k}` as MessageKey)}
            {k === "status" && late && (
              <><IconAlertTriangle size={16} stroke={2} className="ml-1.5 inline-block align-[-2px] text-warning" aria-hidden="true" />
                <span className="sr-only"> ({t("settings.lateBadge")})</span></>
            )}
          </a>
        ))}
      </nav>
      {/* People and Status have their own titles; the other tabs get an h2 for the outline. */}
      {(current === "cloudflare" || current === "sites" || current === "history") && <h2 className="sr-only">{t(`settings.${current}`)}</h2>}
      {current === "people" && <People />}
      {current === "cloudflare" && <CloudflareSettings />}
      {current === "sites" && <SitesSettings />}
      {current === "history" && <HistoryImport />}
      {current === "status" && <Status />}
    </>
  );
}

const useError = () => {
  const { te } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return { error, setError, fail: (e: unknown) => setError(te(e instanceof ApiError ? e.code : "generic")) };
};

// ---------- People and invites ----------

interface UserRow {
  id: string; email: string; name: string; role: "admin" | "member"; mustChangePassword: boolean; disabled: boolean; sites: string[];
}
interface InviteRow { id: string; email: string; role: "admin" | "member"; sites: string[]; expiresAt: string; expired: boolean }

function SitePicker({ sites, value, onChange }: { sites: SiteInfo[]; value: Set<string>; onChange: (s: Set<string>) => void }) {
  const { t } = useI18n();
  const all = sites.length > 0 && sites.every((s) => value.has(s.site_tag));
  return (
    <fieldset className="m-0 rounded-lg border border-border px-3.5 pt-2 pb-2.5">
      <legend className="px-1 text-sm font-semibold">{t("people.sitesAccess")}</legend>
      <label className="flex cursor-pointer items-center gap-2.5 py-1 text-md">
        <input type="checkbox" className={checkboxCls} checked={all} onChange={() => onChange(all ? new Set() : new Set(sites.map((s) => s.site_tag)))} />
        {t("people.selectAll")}
      </label>
      {sites.map((s) => (
        <label key={s.site_tag} className="flex cursor-pointer items-center gap-2.5 py-1 text-md">
          <input type="checkbox" className={checkboxCls} checked={value.has(s.site_tag)} onChange={() => {
            const n = new Set(value);
            if (n.has(s.site_tag)) n.delete(s.site_tag); else n.add(s.site_tag);
            onChange(n);
          }} />
          {s.host}
        </label>
      ))}
    </fieldset>
  );
}

function RoleSelect({ value, onChange }: { value: "admin" | "member"; onChange: (r: "admin" | "member") => void }) {
  const { t } = useI18n();
  // Unique id: the edit dialog opens over the invite form, which also has a RoleSelect.
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelCls}>{t("people.role")}</label>
      <select id={id} className={selectCls} value={value} onChange={(e) => onChange(e.target.value as "admin" | "member")}>
        <option value="member">{t("roles.member")}</option>
        <option value="admin">{t("roles.admin")}</option>
      </select>
    </div>
  );
}

function People() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const { sites } = useSites();
  const f = formatters(locale);
  const [data, setData] = useState<{ users: UserRow[]; invites: InviteRow[] } | null>(null);
  const { error, setError, fail } = useError();
  const load = useCallback(() => get<{ users: UserRow[]; invites: InviteRow[] }>("/api/admin/users").then(setData).catch(fail), []);
  useEffect(() => { void load(); }, [load]);

  // Invite
  const [role, setRole] = useState<"admin" | "member">("member");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [invite, setInvite] = useState<{ url: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const createInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true); setError(null); setInvite(null);
    try {
      const r = await post<{ url: string; email: string }>("/api/admin/invites", {
        email: new FormData(form).get("email"), role, sites: [...chosen],
      });
      setInvite(r); form.reset(); setChosen(new Set()); void load();
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  // Per-person actions
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [confirmTemp, setConfirmTemp] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await load(); } catch (err) { fail(err); }
  };
  const siteName = (tag: string) => sites.find((s) => s.site_tag === tag)?.host ?? tag.slice(0, 8);

  return (
    <div className="grid grid-cols-[minmax(300px,380px)_minmax(0,1fr)] items-start gap-5 max-wide:grid-cols-1">
      <section className={cn(panelCls, "flex flex-col gap-3.5")} aria-labelledby="invite-title">
        <h2 id="invite-title" className={panelTitleCls}>{t("people.invite")}</h2>
        <p className="text-muted">{t("people.inviteLead")}</p>
        <form className={stackCls} onSubmit={createInvite}>
          <Field label={t("auth.email")} name="email" type="email" required autoComplete="off" />
          <RoleSelect value={role} onChange={setRole} />
          {role === "member" ? <SitePicker sites={sites} value={chosen} onChange={setChosen} /> : <p className="text-muted">{t("people.allSites")}</p>}
          <div><Button variant="primary" type="submit" busy={busy}>{t("people.createInvite")}</Button></div>
        </form>
        {invite && (
          <div className={cn(stackCls, "border-t border-border pt-4")}>
            <CopyField label={t("people.inviteReady", { email: invite.email })} value={invite.url} />
            <p className={hintCls}>{t("people.inviteCopyHint")}</p>
          </div>
        )}
      </section>

      <section className={cn(panelCls, "flex flex-col gap-3.5")} aria-labelledby="people-title">
        <h2 id="people-title" className={panelTitleCls}>{t("people.members")}</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {!data ? <Spinner /> : (
          <div className="relative overflow-x-auto">
            <table className={cn(tableCls, stackTableCls)}>
              <thead>
                <tr>
                  <th scope="col" className={dataThCls}>{t("auth.name")}</th>
                  <th scope="col" className={dataThCls}>{t("people.role")}</th>
                  <th scope="col" className={dataThCls}>{t("people.access")}</th>
                  <th scope="col" className={dataThCls}><span className="sr-only">{t("people.actionsHeader")}</span></th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className={cn(stackTrCls, "max-xs:relative max-xs:pr-12", u.disabled && "text-muted")}>
                    <td className={cn(dataTdCls, stackTdCls, "max-xs:before:content-none")}>
                      <p className="font-semibold">{u.name}{u.id === me?.id && <span className="text-sm text-muted"> ({t("people.you")})</span>}</p>
                      <p className="text-sm text-muted">{u.email}</p>
                      {u.mustChangePassword && <span className={tagCls}>{t("people.mustChange")}</span>}
                      {u.disabled && <span className={tagCls}>{t("people.disabled")}</span>}
                    </td>
                    <td className={cn(dataTdCls, stackTdCls)} data-label={t("people.role")}>{t(`roles.${u.role}`)}</td>
                    <td className={cn(dataTdCls, stackTdCls)} data-label={t("people.access")} title={u.sites.map(siteName).join(", ")}>
                      {/* Up to three names, then two and "and N more". */}
                      {u.role === "admin" ? t("people.allAccess") : u.sites.length === 0 ? t("people.noAccess")
                        : u.sites.length <= 3 ? u.sites.map(siteName).join(", ")
                        : `${u.sites.slice(0, 2).map(siteName).join(", ")} ${t("people.andMore", { count: u.sites.length - 2 })}`}
                    </td>
                    <td className={cn(dataTdCls, stackTdCls, "w-[1%] text-right max-xs:absolute max-xs:top-2 max-xs:right-0 max-xs:before:content-none")}>
                      <Menu label={t("people.actions", { name: u.name })} items={[
                        { label: t("people.editAccess"), onClick: () => setEditing(u) },
                        { label: t("people.tempPassword"), onClick: () => setConfirmTemp(u) },
                        ...(u.id === me?.id ? [] : [
                          { label: u.disabled ? t("people.enable") : t("people.disable"), onClick: () => act(() => patch(`/api/admin/users/${u.id}`, { disabled: !u.disabled })) },
                          { label: t("people.delete"), danger: true, onClick: () => setDeleting(u) },
                        ]),
                      ]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.invites.length > 0 && (
          <>
            <h3 className="mt-6 mb-2 text-base font-semibold">{t("people.pending")}</h3>
            <ul>
              {data.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 border-t border-grid py-2.5">
                  <div>
                    <p className="font-semibold">{i.email}</p>
                    <p className="text-muted">{t(`roles.${i.role}`)} · {i.expired ? t("people.expired") : t("people.expires", { date: f.date(i.expiresAt.slice(0, 10)) })}</p>
                  </div>
                  <Button variant="ghost" onClick={() => act(() => del(`/api/admin/invites/${i.id}`))}>{t("people.revoke")}</Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {editing && <EditUser user={editing} sites={sites} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />}
      {confirmTemp && (
        <Dialog title={t("people.tempConfirmTitle", { name: confirmTemp.name })} onClose={() => setConfirmTemp(null)}
          footer={<>
            <Button onClick={() => setConfirmTemp(null)}>{t("app.cancel")}</Button>
            <Button variant="primary" onClick={() => {
              const u = confirmTemp;
              setConfirmTemp(null);
              void act(async () => {
                const r = await post<{ password: string }>(`/api/admin/users/${u.id}/temporary-password`);
                setTemp({ name: u.name, password: r.password });
              });
            }}>{t("people.tempConfirm")}</Button>
          </>}>
          <p>{t("people.tempConfirmLead")}</p>
        </Dialog>
      )}
      {temp && (
        <Dialog title={t("people.tempTitle", { name: temp.name })} onClose={() => setTemp(null)}
          footer={<Button variant="primary" onClick={() => setTemp(null)}>{t("app.close")}</Button>}>
          <p>{t("people.tempLead")}</p>
          <CopyField label={t("auth.password")} value={temp.password} />
        </Dialog>
      )}
      {deleting && (
        <Dialog title={t("people.deleteTitle", { name: deleting.name })} onClose={() => setDeleting(null)}
          footer={<>
            <Button onClick={() => setDeleting(null)}>{t("app.cancel")}</Button>
            <Button variant="danger" onClick={() => { const u = deleting; setDeleting(null); void act(() => del(`/api/admin/users/${u.id}`)); }}>{t("people.confirmDelete")}</Button>
          </>}>
          <p>{t("people.deleteLead")}</p>
        </Dialog>
      )}
    </div>
  );
}

function EditUser({ user, sites, onClose, onSaved }: { user: UserRow; sites: SiteInfo[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [role, setRole] = useState(user.role);
  const [chosen, setChosen] = useState(new Set(user.sites));
  const [busy, setBusy] = useState(false);
  const { error, fail } = useError();
  const save = async () => {
    setBusy(true);
    try { await patch(`/api/admin/users/${user.id}`, { role, sites: [...chosen] }); onSaved(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <Dialog title={user.name} onClose={onClose}
      footer={<><Button onClick={onClose}>{t("app.cancel")}</Button><Button variant="primary" onClick={save} busy={busy}>{busy ? t("app.saving") : t("app.save")}</Button></>}>
      <div className={stackCls}>
        {error && <Notice tone="error">{error}</Notice>}
        <RoleSelect value={role} onChange={setRole} />
        {role === "member" ? <SitePicker sites={sites} value={chosen} onChange={setChosen} /> : <p className="text-muted">{t("people.allSites")}</p>}
      </div>
    </Dialog>
  );
}

// ---------- Cloudflare ----------

function CloudflareSettings() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const { reload } = useSites();
  const late = useCollectionLate();
  const [state, setState] = useState<{ connected: boolean; accounts: { id: string; name: string }[] } | null>(null);
  const [mode, setMode] = useState<"view" | "token" | "accounts">("view");
  const [saved, setSaved] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const { error, setError, fail } = useError();
  const load = () => get<{ connected: boolean; accounts: { id: string; name: string }[] }>("/api/admin/cloudflare").then(setState).catch(fail);
  useEffect(() => { void load(); }, []);
  const done = (n: number) => { setSaved(n); setMode("view"); void load(); void refresh(); reload(); };

  if (!state) return error ? <Notice tone="error">{error}</Notice> : <Spinner />;
  if (!state.connected || mode === "token") {
    return (
      <section className={narrowPanelCls}>
        <CloudflareConnect onDone={done} />
        {state.connected && <div><Button onClick={() => setMode("view")}>{t("app.cancel")}</Button></div>}
      </section>
    );
  }
  return (
    <section className={narrowPanelCls}>
      {error && <Notice tone="error">{error}</Notice>}
      {saved != null && <Notice tone="success">{t("cf.savedDiscovered", { count: saved })}</Notice>}
      {/* Connected is only good news while data is flowing; late collection keeps the chip honest. */}
      <p className={rowCls}><StatusBadge tone={late ? "ni" : "good"}>{late ? t("cf.connectedLate") : t("cf.connected")}</StatusBadge>
        {state.accounts.length === 1 ? t("cf.collectingOne") : t("cf.collecting", { count: state.accounts.length })}</p>
      <ul className="list-disc pl-5">{state.accounts.map((a) => <li key={a.id}>{a.name}</li>)}</ul>
      <Freshness />
      {mode === "accounts"
        ? <CloudflareConnect requireToken={false} initialAccounts={state.accounts.map((a) => a.id)} onDone={done} />
        : (
          <div className={rowCls}>
            <Button onClick={() => setMode("accounts")}>{t("cf.changeAccounts")}</Button>
            <Button onClick={() => setMode("token")}>{t("cf.replaceToken")}</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>{t("cf.disconnect")}</Button>
          </div>
        )}
      {confirm && (
        <Dialog title={t("cf.disconnectTitle")} onClose={() => setConfirm(false)}
          footer={<>
            <Button onClick={() => setConfirm(false)}>{t("app.cancel")}</Button>
            <Button variant="danger" onClick={async () => {
              setConfirm(false); setError(null);
              try { await del("/api/admin/cloudflare"); void load(); void refresh(); } catch (e) { fail(e); }
            }}>{t("cf.disconnect")}</Button>
          </>}>
          <p>{t("cf.disconnectLead")}</p>
        </Dialog>
      )}
    </section>
  );
}

// ---------- Sites ----------

/** Switch: unstyled native checkbox, knob drawn in ::after. */
const switchCls = cn(
  "relative m-0 h-6 w-10 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface-3 transition-colors duration-150 ease-out",
  "checked:border-accent checked:bg-accent",
  "after:absolute after:top-[3px] after:left-[3px] after:size-4 after:rounded-full after:bg-surface after:shadow-[0_1px_2px_rgba(0,0,0,0.3)] after:content-['']",
  "after:transition-transform after:duration-150 after:ease-out checked:after:translate-x-4",
);

interface AdminSite { site_tag: string; host: string; account_id: string; active: number; first_day: string | null; last_day: string | null }

function SitesSettings() {
  const { t, locale } = useI18n();
  const { reload } = useSites();
  const f = formatters(locale);
  const [data, setData] = useState<{ sites: AdminSite[]; accounts: { id: string; name: string }[]; maxSites: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { error, setError, fail } = useError();
  const load = () => get<typeof data>("/api/admin/sites").then(setData).catch(fail);
  useEffect(() => { void load(); }, []);
  const toggle = async (s: AdminSite) => {
    setError(null); setMsg(null);
    try {
      await patch(`/api/admin/sites/${s.site_tag}`, { active: !s.active });
      await load(); reload();
      setMsg(t(s.active ? "sitesAdmin.paused" : "sitesAdmin.resumed", { host: s.host }));
    } catch (e) { fail(e); }
  };
  if (!data) return <Spinner />;
  const accountName = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? id.slice(0, 8);
  return (
    <section className={cn(panelCls, stackCls)}>
      <p className="text-muted">{t("sitesAdmin.lead")} {t("sitesAdmin.limit", { max: data.maxSites })}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {msg && <Notice tone="success">{msg}</Notice>}
      <div className="relative overflow-x-auto">
        <table className={tableCls}>
          <thead><tr>
            <th scope="col" className={dataThCls}>{t("sitesAdmin.site")}</th>
            <th scope="col" className={dataThCls}>{t("sitesAdmin.account")}</th>
            <th scope="col" className={dataThCls}>{t("sitesAdmin.data")}</th>
            <th scope="col" className={dataThCls}>{t("sitesAdmin.active")}</th>
          </tr></thead>
          <tbody>
            {data.sites.map((s) => (
              <tr key={s.site_tag} className={cn(!s.active && "text-muted")}>
                <td className={cn(dataTdCls, "font-semibold")}>{s.host}</td>
                <td className={dataTdCls}>{accountName(s.account_id)}</td>
                <td className={dataTdCls}>{s.first_day && s.last_day ? f.range(s.first_day, s.last_day) : t("sitesAdmin.noData")}</td>
                <td className={dataTdCls}>
                  <label className="inline-flex cursor-pointer">
                    <input type="checkbox" role="switch" className={switchCls} checked={!!s.active} onChange={() => toggle(s)} />
                    <span className="sr-only">{t("sitesAdmin.active")} {s.host}</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button busy={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try { const r = await post<{ upserts: number }>("/api/admin/discover"); setMsg(t("sitesAdmin.discovered", { count: r.upserts })); await load(); reload(); }
          catch (e) { fail(e); } finally { setBusy(false); }
        }}>{t("sitesAdmin.discover")}</Button>
      </div>
    </section>
  );
}

// ---------- Import history ----------

interface BackfillJob { from: string; to: string; cursor: string; offset: number; total: number; startedAt: string; updatedAt: string }
interface BackfillUsage { writesToday: number; writeBudget: number }
interface BackfillStep extends BackfillUsage {
  job: BackfillJob | null; day: string; written: number; errors: string[]; done: boolean; skipped?: string | boolean;
}

/** Days already imported: every day before the cursor. */
const jobDone = (j: BackfillJob) =>
  Math.max(0, Math.min(j.total, Math.round((Date.parse(j.cursor) - Date.parse(j.from)) / 86_400_000)));

/** Network drops retry until back online; server errors give up after a few attempts. */
const SERVER_RETRIES = 8;
const retryable = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 429 || e.status >= 500);
const backoffMs = (attempt: number) => Math.min(60_000, 2000 * 2 ** attempt);

function HistoryImport() {
  const { t, locale } = useI18n();
  const { reload, sites } = useSites();
  const f = formatters(locale);
  const [days, setDays] = useState(90);
  // Draft value: clearing the field to type a new number must not snap to "1".
  const [daysDraft, setDaysDraft] = useState("90");
  const commitDays = () => {
    const n = Math.max(1, Math.min(184, Math.round(Number(daysDraft)) || 90));
    setDays(n); setDaysDraft(String(n));
    return n;
  };
  // ~1.1 s pause + ~0.8 s collection per call; one call per 5 sites per day.
  const estimateMin = Math.max(1, Math.round((days * Math.max(1, Math.ceil(sites.length / 5)) * 1.9) / 60));
  const [loaded, setLoaded] = useState(false);
  const [job, setJob] = useState<BackfillJob | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<"done" | "stopped" | "budget" | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ used: number; budget: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [discarding, setDiscarding] = useState(false);
  const stop = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  const { error, setError, fail } = useError();

  useEffect(() => {
    get<BackfillUsage & { job: BackfillJob | null }>("/api/admin/backfill")
      .then((r) => { setJob(r.job); setUsage({ used: r.writesToday, budget: r.writeBudget }); })
      .catch(fail)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!running) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [running]);

  useEffect(() => {
    const onOnline = () => wake.current?.();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  /** Waits ms with an on-screen countdown; Stop or coming back online ends it early. */
  const wait = (ms: number) => new Promise<void>((resolve) => {
    const end = Date.now() + ms;
    const finish = () => { clearInterval(tick); wake.current = null; setRetryIn(null); resolve(); };
    const tick = setInterval(() => {
      if (stop.current || Date.now() >= end) finish();
      else setRetryIn(Math.ceil((end - Date.now()) / 1000));
    }, 250);
    setRetryIn(Math.ceil(ms / 1000));
    wake.current = finish;
  });

  const run = async (startDays?: number) => {
    stop.current = false;
    setErrors([]); setError(null); setOutcome(null); setRunning(true);
    const end = (o: "done" | "stopped" | "budget" | null) => { setRunning(false); setRetryIn(null); setOutcome(o); };
    let attempt = 0;
    if (startDays) {
      for (;;) {
        try {
          const r = await post<BackfillUsage & { job: BackfillJob }>("/api/admin/backfill/start", { days: startDays });
          setJob(r.job);
          break;
        } catch (e) {
          if (retryable(e) && attempt < SERVER_RETRIES && !stop.current) { await wait(backoffMs(attempt++)); continue; }
          fail(e); end(null); return;
        }
      }
      attempt = 0;
    }
    for (;;) {
      if (stop.current) { end("stopped"); return; }
      try {
        const r = await post<BackfillStep>("/api/admin/backfill/step");
        attempt = 0;
        setUsage({ used: r.writesToday, budget: r.writeBudget });
        if (r.skipped === "not_connected") { setError(t("errors.not_connected")); end(null); return; }
        if (r.errors.length) setErrors((e) => [...e, ...r.errors.map((m) => t("history.errors", { day: r.day, message: m.slice(0, 160) }))].slice(-5));
        if (r.done) { setJob(null); end("done"); reload(); return; }
        setJob(r.job);
        if (r.skipped || r.writesToday > r.writeBudget * 0.9) { end("budget"); reload(); return; }
      } catch (e) {
        if (e instanceof ApiError && e.code === "no_backfill") { setJob(null); end(null); return; }
        const offline = e instanceof ApiError && e.status === 0;
        if (retryable(e) && (offline || attempt < SERVER_RETRIES)) { await wait(backoffMs(attempt++)); continue; }
        fail(e); end("stopped"); return;
      }
      await new Promise((r) => setTimeout(r, 1100)); // GraphQL rate limit headroom.
    }
  };

  const discard = async () => {
    setDiscarding(true);
    try { await del("/api/admin/backfill"); setJob(null); setOutcome(null); setErrors([]); }
    catch (e) { fail(e); } finally { setDiscarding(false); }
  };

  if (!loaded) return <section className={narrowPanelCls}><Spinner /></section>;

  const total = job?.total ?? days;
  const doneCount = job ? jobDone(job) : outcome === "done" ? total : 0;
  return (
    <section className={narrowPanelCls}>
      <p>{t("history.lead")}</p>
      {error && <Notice tone="error">{error}</Notice>}
      {!running && !job && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="days" className={labelCls}>{t("history.days")}</label>
              <input id="days" type="number" inputMode="numeric" className={inputCls} min={1} max={184} value={daysDraft}
                onChange={(e) => setDaysDraft(e.target.value)} onBlur={commitDays} />
            </div>
            <Button variant="primary" onClick={() => { void run(commitDays()); }}>{t("history.start")}</Button>
          </div>
          <p className="text-muted">{t("history.estimate", { minutes: estimateMin, days })}</p>
        </>
      )}
      {(running || job || outcome === "done") && (
        <div className={stackCls}>
          {!running && job && outcome === null && (
            <Notice tone="warning">{t("history.interrupted", { date: f.date(job.cursor), done: doneCount, total })}</Notice>
          )}
          <div className={progressCls} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}
            aria-label={t("history.progress", { done: doneCount, total })}>
            <span className={progressBarCls} style={{ transform: `scaleX(${doneCount / Math.max(total, 1)})` }} />
          </div>
          <p aria-live="polite">
            {running && retryIn != null ? t("history.retrying", { seconds: retryIn })
              : running && job ? t("history.running", { day: f.date(job.cursor) }) : null}
            {" "}{t("history.progress", { done: doneCount, total })}
          </p>
          {running && <p className="text-muted">{t("history.keepOpen")}</p>}
          {outcome === "done" && <Notice tone="success">{t("history.done")}</Notice>}
          {outcome === "stopped" && <Notice tone="warning">{t("history.stopped")}</Notice>}
          {outcome === "budget" && <Notice tone="warning">{t("history.budgetStop")}</Notice>}
          <div className={rowCls}>
            {running
              ? <Button onClick={() => { stop.current = true; wake.current?.(); }}>{t("history.stop")}</Button>
              : job && (
                <>
                  <Button variant="primary" onClick={() => { void run(); }}>{t("history.resume")}</Button>
                  <Button busy={discarding} onClick={discard}>{t("history.discard")}</Button>
                </>
              )}
          </div>
        </div>
      )}
      {usage && <p className="text-muted">{t("history.writes", { used: f.full(usage.used), budget: f.full(usage.budget) })}</p>}
      {errors.length > 0 && <Notice tone="error">{errors.map((m, i) => <p key={i}>{m}</p>)}</Notice>}
    </section>
  );
}

// ---------- Status ----------

interface StatusData {
  runs: { job: string; period: string; status: string; detail: string; ran_at: string }[];
  rows: { hourly: number; daily: number; dims: number; vitals: number };
  connected: boolean; lastSuccess: string | null; lastAttempt: string | null;
  dbBytes: number | null; dbLimit: number;
  writesToday: number; writeBudget: number;
}

const errorCodeCls = "max-w-full rounded-sm bg-surface px-1.5 py-0.5 font-mono text-sm break-words text-ink";
/** Tighter tracking: with default mono spacing "15 * * * *" looked like masked text. */
const cronCls = cn(errorCodeCls, "tracking-[-0.03em] whitespace-nowrap");

/**
 * Is collection current? If not, why and what to do. A stopped cron writes nothing, so this
 * compares the last success with the last attempt.
 */
function CollectionHealth({ data, when, runNow }: { data: StatusData; when: (iso: string) => string; runNow: ReactNode }) {
  const { t, locale } = useI18n();
  const { timeZone } = useSites();
  const f = formatters(locale);
  const cfLink = (key: "connect" | "replaceToken") => (
    <a href="/settings/cloudflare" onClick={onLinkClick} className="font-medium">{t(`status.health.${key}`)}</a>
  );

  if (!data.connected) return <Notice tone="warning"><p>{t("status.health.notConnected")}</p>{cfLink("connect")}</Notice>;
  if (!data.lastAttempt) {
    const msg = data.rows.daily > 0
      ? t("status.health.imported", { time: f.clock(nextCollection(), timeZone) })
      : t("status.health.noRuns");
    return <Notice tone="info"><p>{msg}</p>{runNow}</Notice>;
  }

  const now = Date.now();
  const latest = data.runs.find((r) => r.job === "hourly");
  const errs = latest && latest.status !== "ok" ? runErrors(latest.detail) : [];
  const success = data.lastSuccess ? new Date(data.lastSuccess) : null;
  const attempt = new Date(data.lastAttempt);
  const stale = !success || now - success.getTime() > STALE_MS;
  const idle = now - attempt.getTime() > STALE_MS;

  const errorBlock = errs.length > 0 && (
    <>
      <p className="font-medium">{t("status.health.latestError")}</p>
      <code className={errorCodeCls}>{errs[0]}</code>
      {errs.length > 1 && <p className="text-sm text-ink-2">{t("status.moreErrors", { count: errs.length - 1 })}</p>}
    </>
  );
  const nextStep = errs.some(isTokenError)
    ? <><p>{t("status.health.tokenRejected")}</p>{cfLink("replaceToken")}</>
    : <p>{t("status.health.retry")}</p>;

  if (!stale && success) {
    if (!errs.length) {
      return <Notice tone="success"><p>{t("status.health.ok", { time: f.clock(success, timeZone), next: f.clock(nextCollection(now), timeZone) })}</p></Notice>;
    }
    return <Notice tone="warning"><p>{t("status.health.failing", { ago: f.ago(attempt) })}</p>{errorBlock}{nextStep}{runNow}</Notice>;
  }

  const head = success && data.lastSuccess
    ? t("status.health.stale", { ago: f.ago(success), when: when(data.lastSuccess) })
    : t("status.health.neverSucceeded");
  if (idle) {
    return (
      <Notice tone="warning">
        <p className="font-semibold">{head}</p>
        <p>{t("status.health.cronIdle")}</p>
        <p>
          {t("status.health.cronCheck")}{" "}
          {["15 * * * *", "45 * * * *"].map((c, i) => <span key={c}>{i > 0 && " "}<code className={cronCls}>{c}</code></span>)}
        </p>
        {errorBlock}
        {runNow}
      </Notice>
    );
  }
  return (
    <Notice tone="error">
      <p className="font-semibold">{head}</p>
      <p>{t("status.health.failing", { ago: f.ago(attempt) })}</p>
      {errorBlock}{nextStep}{runNow}
    </Notice>
  );
}

function Meter({ id, label, used, max, pct }: { id: string; label: string; used: number; max: number; pct: (n: number) => string }) {
  return (
    <div>
      {/* Percent on the right, never orphaned on its own line under the label at phone width. */}
      <p id={id} className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">{label}</span>
        <span className="flex-none text-ink-2 tabular-nums">{pct((used / Math.max(max, 1)) * 100)}</span>
      </p>
      <div className={cn(progressCls, "mt-1.5")} role="meter" aria-labelledby={id} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
        <span className={progressBarCls} style={{ transform: `scaleX(${Math.min(used / Math.max(max, 1), 1)})` }} />
      </div>
    </div>
  );
}

function Status() {
  const { t, locale } = useI18n();
  const { timeZone, reload } = useSites();
  const f = formatters(locale);
  const [data, setData] = useState<StatusData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { error, setError, fail } = useError();
  const load = () => get<StatusData>("/api/admin/status").then(setData).catch(fail);
  useEffect(() => { void load(); }, []);
  const run = async (path: string) => {
    setBusy(path); setMsg(null); setError(null);
    try { await post(path); setMsg(t("status.ran")); await load(); reload(); } catch (e) { fail(e); } finally { setBusy(null); }
  };
  if (!data) return error ? <Notice tone="error">{error}</Notice> : <Spinner />;
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${f.date(f.localDate(d, timeZone), { day: "numeric", month: "short" })} ${f.clock(d, timeZone)}`;
  };
  const mb = new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  const hourly = "/api/admin/run/hourly";
  // The button sits in the notice when running collection is the next step, else beside maintenance.
  const runNowBtn = <div className="mt-1"><Button busy={busy === hourly} onClick={() => run(hourly)}>{t("status.runNow")}</Button></div>;
  const health = <CollectionHealth data={data} when={when} runNow={runNowBtn} />;
  const lastAny = data.lastAttempt ?? data.lastSuccess;
  const idleSince = data.connected && lastAny && Date.now() - Date.parse(lastAny) > STALE_MS ? lastAny : null;
  const offersRun = data.connected && (!data.lastAttempt || !data.lastSuccess
    || Date.now() - Date.parse(data.lastSuccess) > STALE_MS || data.runs.find((r) => r.job === "hourly")?.status !== "ok");
  return (
    <div className={stackCls}>
      {/* Notices sit above the panels, not boxed inside one (a bordered box in a bordered box). */}
      {health}
      {msg && <Notice tone="success">{msg}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <section className={cn(panelCls, stackCls)} aria-label={t("settings.status")}>
        <h2 id="rows-title" className={panelTitleCls}>{t("status.rows")}</h2>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3" aria-labelledby="rows-title">
          {([
            [t("status.hourly"), data.rows.hourly], [t("status.daily"), data.rows.daily],
            [t("status.dims"), data.rows.dims], [t("status.vitalsRows"), data.rows.vitals],
          ] as const).map(([label, n]) => (
            <div key={label} className="rounded-lg bg-surface-2 px-3.5 py-3">
              <dt className="text-sm text-muted">{label}</dt>
              <dd className="m-0 text-[22px] font-[650] tabular-nums">{f.full(n)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-2 flex flex-col gap-3" role="group" aria-labelledby="limits-title">
          <h2 id="limits-title" className={panelTitleCls}>{t("status.limits")}</h2>
          <Meter id="writes-label" label={t("history.writes", { used: f.full(data.writesToday), budget: f.full(data.writeBudget) })}
            used={data.writesToday} max={data.writeBudget} pct={f.pct} />
          <p className="-mt-1.5 text-sm text-muted">{t("status.budgetNote", { budget: f.full(data.writeBudget) })}</p>
          {data.dbBytes != null && (
            <Meter id="db-label" label={t("status.dbSize", { used: mb.format(data.dbBytes / 1e6), limit: mb.format(data.dbLimit / 1e6) })}
              used={data.dbBytes} max={data.dbLimit} pct={f.pct} />
          )}
        </div>
        <div className={rowCls}>
          {!offersRun && <Button busy={busy === hourly} onClick={() => run(hourly)}>{t("status.runNow")}</Button>}
          <Button busy={busy === "/api/admin/run/maintenance"} onClick={() => run("/api/admin/run/maintenance")}>{t("status.runMaintenance")}</Button>
        </div>
      </section>
      <section className={cn(panelCls, stackCls)} aria-labelledby="runs-title">
        <header>
          <h2 id="runs-title" className={panelTitleCls}>{t("status.runsTitle")}</h2>
        </header>
        {data.runs.length === 0 ? <p className={emptyCls}>{t("status.noRuns")}</p> : (
          <div className="relative overflow-x-auto">
            <table className={cn(tableCls, stackTableCls)}>
              <thead><tr>
                <th scope="col" className={dataThCls}>{t("status.job")}</th>
                <th scope="col" className={dataThCls}>{t("status.period")}</th>
                <th scope="col" className={dataThCls}>{t("status.result")}</th>
                <th scope="col" className={dataThCls}>{t("status.when")}</th>
              </tr></thead>
              <tbody>
                {/* The log would end on old green rows; when nothing has run lately, say so first. */}
                {idleSince && (
                  <tr className={stackTrCls}>
                    <td className={cn(dataTdCls, stackTdCls, "max-xs:font-semibold max-xs:before:content-none")}>{t("status.jobs.hourly")}</td>
                    <td className={cn(dataTdCls, stackTdCls)} data-label={t("status.period")}>—</td>
                    <td className={cn(dataTdCls, stackTdCls, "max-xs:before:content-none")}>
                      <StatusBadge tone="ni">{t("status.noRunSince", { time: when(idleSince) })}</StatusBadge>
                    </td>
                    <td className={cn(dataTdCls, stackTdCls, "whitespace-nowrap")} data-label={t("status.when")}>—</td>
                  </tr>
                )}
                {data.runs.map((r) => {
                  const errs = r.status === "ok" ? [] : runErrors(r.detail);
                  return (
                    <tr key={`${r.job}-${r.period}`} className={stackTrCls}>
                      <td className={cn(dataTdCls, stackTdCls, "max-xs:font-semibold max-xs:before:content-none")}>{r.job === "hourly" || r.job === "close" ? t(`status.jobs.${r.job}`) : r.job}</td>
                      <td className={cn(dataTdCls, stackTdCls)} data-label={t("status.period")}>{r.period.includes("T") ? when(r.period) : f.date(r.period, { day: "numeric", month: "short" })}</td>
                      <td className={cn(dataTdCls, stackTdCls, "max-xs:before:content-none")}>
                        <StatusBadge tone={r.status === "ok" ? "good" : "poor"}>{r.status === "ok" ? t("status.ok") : t("status.error")}</StatusBadge>
                        {errs.length > 0 && (
                          <p className="mt-1 max-w-[56ch] font-mono text-sm break-words text-ink-2">
                            {errs[0]}{errs.length > 1 && <span className="font-sans"> · {t("status.moreErrors", { count: errs.length - 1 })}</span>}
                          </p>
                        )}
                      </td>
                      <td className={cn(dataTdCls, stackTdCls, "whitespace-nowrap")} data-label={t("status.when")}>{when(r.ran_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
