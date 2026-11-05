import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, post, type Me } from "./api";
import { LOCALES, useI18n, type Locale } from "./i18n";
import { navigate } from "./router";
import { useSession } from "./session";
import { CloudflareConnect } from "./CloudflareConnect";
import { Button, cn, Field, FlareMark, labelCls, Notice, selectCls, Spinner } from "./ui";
import { useTitle } from "./useTitle";
import { ThemeSelect } from "./theme";

/** Centered layout for auth screens and the initial load. */
export const authPageCls = "flex min-h-screen flex-col items-center justify-start gap-6 px-4 pt-[clamp(32px,10vh,112px)] pb-12";

export function LanguageSelect() {
  const { t, locale } = useI18n();
  const { changeLocale } = useSession();
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelCls}>{t("app.language")}</span>
      <select value={locale} onChange={(e) => changeLocale(e.target.value as Locale)} className={selectCls}>
        {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}

function AuthLayout({ title, lead, children, wide, hidePrefs, hideTheme }: {
  title: string; lead?: ReactNode; children: ReactNode; wide?: boolean; hidePrefs?: boolean; hideTheme?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={authPageCls}>
      <main id="main" className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-surface p-8 max-xs:px-5 max-xs:py-6",
        wide ? "w-[min(640px,100%)]" : "w-[min(440px,100%)]",
      )}>
        <FlareMark size={40} />
        <span className="sr-only">{t("app.name")}</span>
        <h1 className="text-[24px] font-[650] tracking-[-0.01em]">{title}</h1>
        {lead && <p className="-mt-2 text-ink-2">{lead}</p>}
        {children}
      </main>
      {!hidePrefs && (
        <div className="flex w-[min(240px,100%)] flex-col gap-3">
          <LanguageSelect />
          {!hideTheme && <ThemeSelect />}
        </div>
      )}
    </div>
  );
}

const useFormError = () => {
  const { te } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return { error, setError, fail: (e: unknown) => setError(te(e instanceof ApiError ? e.code : "generic")) };
};

export function LoginPage() {
  const { t } = useI18n();
  useTitle(t("auth.signInTitle"));
  const { setMe } = useSession();
  const { error, setError, fail } = useFormError();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: Me }>("/api/auth/login", { email: f.get("email"), password: f.get("password") });
      setMe(r.user);
      navigate(r.user.mustChangePassword ? "/change-password" : "/", true);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title={t("auth.signInTitle")} lead={t("auth.signInLead")}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label={t("auth.email")} name="email" type="email" autoComplete="username" required autoFocus />
        <Field label={t("auth.password")} name="password" type="password" autoComplete="current-password" required />
        <Button variant="primary" type="submit" busy={busy}>{busy ? t("auth.signingIn") : t("auth.signIn")}</Button>
        <p className="text-muted">{t("auth.forgot")}</p>
      </form>
    </AuthLayout>
  );
}

function PasswordPair({ autoFocus }: { autoFocus?: boolean }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t("auth.newPassword")} name="password" type="password" autoComplete="new-password"
        minLength={10} required hint={t("auth.passwordHint")} autoFocus={autoFocus} />
      <Field label={t("auth.confirmPassword")} name="confirm" type="password" autoComplete="new-password" minLength={10} required />
    </>
  );
}

export function SetupPage() {
  const { t, locale } = useI18n();
  useTitle(t("auth.setupTitle"));
  const { me, setMe, refresh } = useSession();
  const { error, setError, fail } = useFormError();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(me ? 2 : 1);

  const createAdmin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError(t("auth.mismatch"));
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: Me }>("/api/auth/setup", {
        appKey: f.get("appKey"), name: f.get("name"), email: f.get("email"), password: f.get("password"), locale,
      });
      setMe(r.user);
      setStep(2);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const steps = [t("auth.setupStep1"), t("auth.setupStep2"), t("auth.setupStep3")];
  return (
    <AuthLayout hideTheme title={t("auth.setupTitle")} lead={step === 1 ? t("auth.setupLead") : undefined} wide={step === 2}>
      <ol className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted" aria-label={t("auth.setupTitle")}>
        {steps.map((s, i) => {
          const current = step === i + 1, done = step > i + 1;
          return (
            <li key={s} aria-current={current ? "step" : undefined} className={cn("flex items-center gap-2", current && "font-semibold text-ink")}>
              <span aria-hidden="true" className={cn(
                "inline-grid size-6 place-items-center rounded-full border text-sm font-semibold",
                current ? "border-accent bg-accent text-accent-ink" : done ? "border-good bg-surface-2 text-good" : "border-border-strong",
              )}>{i + 1}</span>{s}
            </li>
          );
        })}
      </ol>
      {step === 1 && (
        <form className="flex flex-col gap-4" onSubmit={createAdmin}>
          {error && <Notice tone="error">{error}</Notice>}
          <Field label={t("auth.appKey")} name="appKey" type="password" autoComplete="off" required hint={t("auth.appKeyHint")} autoFocus />
          <Field label={t("auth.name")} name="name" autoComplete="name" required />
          <Field label={t("auth.email")} name="email" type="email" autoComplete="username" required />
          <PasswordPair />
          <Button variant="primary" type="submit" busy={busy}>{busy ? t("auth.creating") : t("auth.createAdmin")}</Button>
        </form>
      )}
      {step === 2 && <CloudflareConnect onDone={() => { void refresh(); setStep(3); }} />}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{t("auth.setupDoneTitle")}</h2>
          <p>{t("auth.setupDoneLead")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={() => navigate("/settings/history")}>{t("auth.importNow")}</Button>
            <Button onClick={() => navigate("/")}>{t("auth.goToDashboard")}</Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

const INVITE_KEY = "fa_invite";

/** Invite code from the fragment (or a legacy path), kept for reloads after the URL is cleaned. */
function readInviteCode(legacyCode?: string) {
  let code = legacyCode || "";
  try { code = decodeURIComponent(location.hash.slice(1)) || code; } catch { /* malformed fragment */ }
  try {
    if (code) sessionStorage.setItem(INVITE_KEY, code);
    return code || sessionStorage.getItem(INVITE_KEY) || "";
  } catch { return code; }
}

export function InvitePage({ legacyCode }: { legacyCode?: string }) {
  const { t, te, locale } = useI18n();
  const { setMe } = useSession();
  const { error, setError, fail } = useFormError();
  const [code] = useState(() => readInviteCode(legacyCode));
  const [invite, setInvite] = useState<{ email: string; role: "admin" | "member" } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (location.pathname !== "/invite" || location.hash) {
      history.replaceState(null, "", "/invite");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, []);

  useEffect(() => {
    if (!code) { setLoadError(te("invite_not_found")); return; }
    post<{ email: string; role: "admin" | "member" }>("/api/auth/invite/info", { code })
      .then(setInvite).catch((e) => setLoadError(te(e instanceof ApiError ? e.code : "generic")));
  }, [code, te]);

  const accept = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError(t("auth.mismatch"));
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: Me }>("/api/auth/invite/accept", { code, name: f.get("name"), password: f.get("password"), locale });
      try { sessionStorage.removeItem(INVITE_KEY); } catch { /* no storage */ }
      setMe(r.user);
      navigate("/", true);
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  if (loadError) {
    return (
      <AuthLayout title={t("auth.inviteTitle")}>
        <Notice tone="error">{loadError}</Notice>
        <Button onClick={() => navigate("/login")}>{t("auth.signIn")}</Button>
      </AuthLayout>
    );
  }
  if (!invite) return <div className={authPageCls}><Spinner /></div>;
  return (
    <AuthLayout title={t("auth.inviteTitle")} lead={t("auth.inviteLead", { role: t(`roles.${invite.role}`) })}>
      <form className="flex flex-col gap-4" onSubmit={accept}>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label={t("auth.email")} value={invite.email} readOnly autoComplete="username" />
        <Field label={t("auth.name")} name="name" autoComplete="name" required autoFocus />
        <PasswordPair />
        <Button variant="primary" type="submit" busy={busy}>{busy ? t("auth.creating") : t("auth.acceptInvite")}</Button>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordPage() {
  const { t } = useI18n();
  const { me, setMe } = useSession();
  const { error, setError, fail } = useFormError();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const forced = !!me?.mustChangePassword;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("password") !== f.get("confirm")) return setError(t("auth.mismatch"));
    setBusy(true); setError(null);
    try {
      const r = await post<{ user: Me }>("/api/auth/change-password", { current: f.get("current"), password: f.get("password") });
      setMe(r.user);
      if (forced) navigate("/", true);
      else { setDone(true); form.reset(); }
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  return (
    <AuthLayout hidePrefs title={t("auth.changeTitle")} lead={forced ? t("auth.changeForcedLead") : t("auth.changeLead")}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice tone="success">{t("auth.passwordChanged")}</Notice>}
        <input type="email" name="username" value={me?.email ?? ""} autoComplete="username" readOnly hidden />
        <Field label={t("auth.currentPassword")} name="current" type="password" autoComplete="current-password" required autoFocus />
        <PasswordPair />
        <Button variant="primary" type="submit" busy={busy}>{t("auth.updatePassword")}</Button>
        {!forced && <Button variant="ghost" type="button" onClick={() => navigate("/")}>{t("auth.goToDashboard")}</Button>}
      </form>
    </AuthLayout>
  );
}
