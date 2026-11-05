import { useEffect } from "react";
import { authPageCls, ChangePasswordPage, InvitePage, LoginPage, SetupPage } from "./AuthPages";
import { TrafficPage, VitalsPage } from "./Dashboard";
import { OverviewPage } from "./Overview";
import { SettingsPage } from "./Settings";
import { Shell } from "./Shell";
import { match, navigate, useLocation } from "./router";
import { useSession } from "./session";
import { Spinner } from "./ui";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

export function App() {
  const { me, ready, needsSetup, connected } = useSession();
  const { path } = useLocation();

  if (!ready) return <div className={authPageCls}><Spinner /></div>;

  const invite = path === "/invite" ? {} : match("/invite/:code", path);
  if (invite) return <InvitePage legacyCode={invite.code} />;

  if (needsSetup) return path === "/setup" ? <SetupPage /> : <Redirect to="/setup" />;
  if (!me) return path === "/login" ? <LoginPage /> : <Redirect to="/login" />;
  if (me.mustChangePassword || path === "/change-password") return <ChangePasswordPage />;
  // An admin without Cloudflare connected resumes setup (step 2).
  if (me.role === "admin" && connected === false && !path.startsWith("/settings")) {
    return path === "/setup" ? <SetupPage /> : <Redirect to="/setup" />;
  }
  if (path === "/setup" || path === "/login") return <Redirect to="/" />;

  const site = match("/site/:tag", path);
  const vitals = match("/site/:tag/vitals", path);
  const settings = match("/settings/:tab", path);
  let page;
  if (path === "/") page = <OverviewPage />;
  else if (site) page = <TrafficPage key={site.tag} siteTag={site.tag} />;
  else if (vitals) page = <VitalsPage key={vitals.tag} siteTag={vitals.tag} />;
  else if (me.role === "admin" && (path === "/settings" || settings)) page = <SettingsPage tab={settings?.tab ?? ""} />;
  else page = <Redirect to="/" />;

  return <Shell>{page}</Shell>;
}
