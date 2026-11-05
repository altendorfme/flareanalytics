import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconAdjustmentsHorizontal, IconChartBar, IconChevronDown, IconGauge, IconLayoutGrid, IconKey, IconLogout, IconMenu2, IconSearch, IconSettings, IconX } from "@tabler/icons-react";
import { fetchSites, type SiteInfo } from "./api";
import { useI18n } from "./i18n";
import { navigate, onLinkClick, useLocation } from "./router";
import { useSession } from "./session";
import { LanguageSelect } from "./AuthPages";
import { ThemeSelect } from "./theme";
import { cn, iconBtnCls, inputCls, Notice, Spinner } from "./ui";
import { Favicon } from "./icons";

interface SitesValue { sites: SiteInfo[]; timeZone: string; lastRun: string | null; reload: () => void }
const SitesCtx = createContext<SitesValue | null>(null);
export const useSites = () => useContext(SitesCtx)!;

const navItemCls = (active: boolean) => cn(
  "flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-md text-ink no-underline hover:bg-surface-2 hover:text-ink",
  active && "bg-surface-2 font-semibold",
);
const subnavCls = (current: boolean) => cn(
  "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-md no-underline",
  current ? "bg-accent-soft font-semibold text-accent hover:text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
);
const quietCls = "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-md text-ink-2 no-underline hover:bg-surface-2 hover:text-ink";
/** Below this width the sidebar is a drawer (matches the `nav` breakpoint in styles.css). */
const MOBILE_NAV = "(width < 56.25rem)";
/** Site count at which the list gets a filter. */
const FILTER_FROM = 9;

export function Shell({ children }: { children: ReactNode }) {
  const { t, te } = useI18n();
  const { me, signOut } = useSession();
  const { path, search } = useLocation();
  const [data, setData] = useState<Omit<SitesValue, "reload"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [filter, setFilter] = useState("");
  // Announce the new page title to screen readers.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    const id = setTimeout(() => setAnnounce(document.title), 400);
    return () => clearTimeout(id);
  }, [path]);

  useEffect(() => {
    fetchSites().then(setData).catch((e) => setError(te(e?.code ?? "generic")));
  }, [tick, te]);
  // Close the mobile menu on navigation.
  useEffect(() => setOpen(false), [path]);

  // Mobile drawer as a modal: Esc closes, background is inert, focus returns to the button.
  const toggle = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const mobile = matchMedia(MOBILE_NAV).matches;
    const main = document.getElementById("main");
    const header = bar.current;
    if (open && mobile) {
      main?.setAttribute("inert", "");
      header?.setAttribute("inert", "");
      drawer.current?.querySelector<HTMLElement>("a, button, select")?.focus();
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
      document.addEventListener("keydown", onKey);
      wasOpen.current = true;
      return () => { document.removeEventListener("keydown", onKey); main?.removeAttribute("inert"); header?.removeAttribute("inert"); };
    }
    if (!open && wasOpen.current) { wasOpen.current = false; toggle.current?.focus(); }
  }, [open]);

  const currentSite = path.match(/^\/site\/([a-f0-9]{32})/)?.[1];
  const siteHost = data?.sites.find((s) => s.site_tag === currentSite)?.host;
  const here: ReactNode = siteHost
    ? <><Favicon host={siteHost} /><span className="truncate">{siteHost}</span><span className="flex-none font-normal text-muted">· {t(path.endsWith("/vitals") ? "nav.vitals" : "nav.traffic")}</span></>
    : path === "/" ? t("nav.overview") : path.startsWith("/settings") ? t("nav.settings") : null;
  const allSites = data?.sites ?? [];
  const canFilter = allSites.length >= FILTER_FROM;
  const needle = canFilter ? filter.trim().toLowerCase() : "";
  // Keep the open site in the list even when filtered out.
  const shown = needle ? allSites.filter((s) => s.host.toLowerCase().includes(needle) || s.site_tag === currentSite) : allSites;
  const qs = new URLSearchParams(search);
  const keep = ["period", "from", "to"].filter((k) => qs.has(k)).map((k) => `${k}=${qs.get(k)}`).join("&");
  const withPeriod = (href: string) => (keep ? `${href}?${keep}` : href);

  return (
    <SitesCtx.Provider value={{ ...(data ?? { sites: [], timeZone: "America/Sao_Paulo", lastRun: null }), reload: () => setTick((n) => n + 1) }}>
      <a className="absolute -top-12 left-4 z-50 rounded-lg bg-accent px-3.5 py-2 text-accent-ink hover:text-accent-ink focus:top-3" href="#main">
        {t("app.skipToContent")}
      </a>
      <div className="grid min-h-screen grid-cols-[264px_minmax(0,1fr)] max-nav:grid-cols-[minmax(0,1fr)] max-nav:grid-rows-[auto_1fr] max-nav:content-start">
        <header ref={bar} className="sticky top-0 z-20 hidden h-14 items-center gap-2 border-b border-border bg-surface px-2 max-nav:flex">
          <button ref={toggle} className={iconBtnCls} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="sidebar"
            aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}>
            {open ? <IconX size={22} aria-hidden="true" /> : <IconMenu2 size={22} aria-hidden="true" />}
          </button>
          {/* Context after scrolling; the page h1 already tells screen readers. */}
          {here && <span className="flex min-w-0 items-center gap-2 text-md font-semibold" aria-hidden="true">{here}</span>}
        </header>

        <aside id="sidebar" ref={drawer} aria-label={t("nav.sidebar")} className={cn(
          "sticky top-0 flex h-screen flex-col gap-5 overflow-y-auto border-r border-border bg-surface px-3 py-4",
          "max-nav:fixed max-nav:inset-y-0 max-nav:left-0 max-nav:z-30 max-nav:w-[min(300px,86vw)] max-nav:shadow-popover",
          "max-nav:transition-transform max-nav:duration-200 max-nav:ease-out-soft",
          !open && "max-nav:invisible max-nav:-translate-x-full",
        )}>
          {/* No brand mark: hidden on desktop; on mobile only the drawer close button. */}
          <div className="hidden justify-end max-nav:flex">
            <button className={iconBtnCls} onClick={() => setOpen(false)} aria-label={t("nav.closeMenu")}>
              <IconX size={22} aria-hidden="true" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col gap-1" aria-label={t("nav.main")}>
            <a href={withPeriod("/")} onClick={onLinkClick} className={cn(navItemCls(path === "/"), "mb-3")}
              aria-current={path === "/" ? "page" : undefined}>
              <IconLayoutGrid size={20} stroke={1.75} aria-hidden="true" /><span className="truncate">{t("nav.overview")}</span>
            </a>
            <p className="px-2.5 pb-1 text-sm font-semibold text-muted" id="nav-sites">{t("nav.sites")}</p>
            {canFilter && (
              <div className="relative mb-1.5">
                <IconSearch size={16} stroke={1.75} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape" && filter) { e.stopPropagation(); setFilter(""); } }}
                  aria-label={t("nav.filterSites")} placeholder={t("nav.filterPlaceholder", { n: allSites.length })}
                  className={cn(inputCls, "pl-9")} />
              </div>
            )}
            {needle && <p className="sr-only" role="status" aria-live="polite">{t("nav.filterCount", { n: shown.length })}</p>}
            {needle && shown.length === 0 && <p className="px-2.5 text-sm text-muted">{t("nav.filterEmpty", { q: filter.trim() })}</p>}
            {!data && !error && <Spinner />}
            {data && !data.sites.length && <p className="px-2.5 text-sm text-muted">{t("nav.noSites")}</p>}
            <ul aria-labelledby="nav-sites" className="flex flex-col gap-0.5">
              {shown.map((s) => {
                const active = s.site_tag === currentSite;
                return (
                  <li key={s.site_tag}>
                    <a href={withPeriod(`/site/${s.site_tag}`)} onClick={onLinkClick}
                      className={navItemCls(active)} aria-current={active && !path.endsWith("/vitals") ? "page" : undefined}>
                      <Favicon host={s.host} /><span className="truncate">{s.host}</span>
                    </a>
                    {active && (
                      <ul className="flex flex-col gap-0.5 pt-0.5 pb-1.5 pl-3">
                        <li>
                          <a href={withPeriod(`/site/${s.site_tag}`)} onClick={onLinkClick} className={subnavCls(!path.endsWith("/vitals"))}
                            aria-current={!path.endsWith("/vitals") ? "page" : undefined}>
                            <IconChartBar size={18} stroke={1.75} aria-hidden="true" />{t("nav.traffic")}
                          </a>
                        </li>
                        <li>
                          <a href={withPeriod(`/site/${s.site_tag}/vitals`)} onClick={onLinkClick} className={subnavCls(path.endsWith("/vitals"))}
                            aria-current={path.endsWith("/vitals") ? "page" : undefined}>
                            <IconGauge size={18} stroke={1.75} aria-hidden="true" />{t("nav.vitals")}
                          </a>
                        </li>
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {me?.role === "admin" && (
              <a href="/settings" onClick={onLinkClick} className={navItemCls(path.startsWith("/settings"))}
                aria-current={path.startsWith("/settings") ? "page" : undefined}>
                <IconSettings size={20} stroke={1.75} aria-hidden="true" /><span className="truncate">{t("nav.settings")}</span>
              </a>
            )}
            <div className="flex flex-col gap-2 px-2.5" role="group" aria-label={t("nav.account")}>
              <p className="text-md font-semibold">{me?.name}</p>
              <p className="-mt-2 truncate text-sm text-muted">{me?.email}</p>
              <div className="-mx-2.5 flex flex-col gap-0.5">
                {/* Collapsed so it doesn't take height from the site list. */}
                <details className="group">
                  <summary className={cn(quietCls, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                    <IconAdjustmentsHorizontal size={18} stroke={1.75} aria-hidden="true" />{t("nav.preferences")}
                    <IconChevronDown size={16} stroke={1.75} aria-hidden="true" className="ml-auto transition-transform duration-150 group-open:rotate-180" />
                  </summary>
                  <div className="flex flex-col gap-3 px-2.5 pt-2 pb-2">
                    <LanguageSelect />
                    <ThemeSelect />
                  </div>
                </details>
                <a href="/change-password" onClick={onLinkClick} className={quietCls}>
                  <IconKey size={18} stroke={1.75} aria-hidden="true" />{t("nav.changePassword")}
                </a>
                <button className={quietCls} onClick={async () => { await signOut(); navigate("/login", true); }}>
                  <IconLogout size={18} stroke={1.75} aria-hidden="true" />{t("nav.signOut")}
                </button>
              </div>
            </div>
          </div>
        </aside>
        {open && <div className="fixed inset-0 z-25 hidden bg-black/40 max-nav:block" onClick={() => setOpen(false)} aria-hidden="true" />}

        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        <main id="main" className="mx-auto w-full max-w-[1280px] px-8 pt-7 pb-12 outline-none max-nav:px-4 max-nav:pt-5 max-nav:pb-10" tabIndex={-1}>
          {error ? <Notice tone="error">{error}</Notice> : data ? children : <Spinner />}
        </main>
      </div>
    </SitesCtx.Provider>
  );
}
