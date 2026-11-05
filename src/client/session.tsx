import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, patch, post, type Me } from "./api";
import { useI18n, type Locale } from "./i18n";

interface SessionValue {
  me: Me | null;
  connected: boolean | undefined;
  needsSetup: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
  setMe: (m: Me | null) => void;
  signOut: () => Promise<void>;
  changeLocale: (l: Locale) => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { setLocale } = useI18n();
  const [me, setMeState] = useState<Me | null>(null);
  const [connected, setConnected] = useState<boolean | undefined>(undefined);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [ready, setReady] = useState(false);

  const setMe = useCallback((m: Me | null) => {
    setMeState(m);
    // The account's saved preference wins over the browser's.
    if (m?.locale) setLocale(m.locale as Locale);
  }, [setLocale]);

  const refresh = useCallback(async () => {
    try {
      const r = await get<{ user: Me; connected?: boolean }>("/api/auth/me");
      setMe(r.user);
      setConnected(r.connected);
      setNeedsSetup(false);
    } catch {
      setMeState(null);
      const s = await get<{ needsSetup: boolean }>("/api/auth/status").catch(() => ({ needsSetup: false }));
      setNeedsSetup(s.needsSetup);
    } finally {
      setReady(true);
    }
  }, [setMe]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The API signals an expired session or a required password change.
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener("fa:auth", on);
    return () => window.removeEventListener("fa:auth", on);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await post("/api/auth/logout").catch(() => null);
    setMeState(null);
  }, []);

  const changeLocale = useCallback((l: Locale) => {
    setLocale(l);
    if (me) void patch("/api/auth/me", { locale: l }).catch(() => null);
  }, [me, setLocale]);

  return (
    <Ctx.Provider value={{ me, connected, needsSetup, ready, refresh, setMe, signOut, changeLocale }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession fora do SessionProvider");
  return v;
}
