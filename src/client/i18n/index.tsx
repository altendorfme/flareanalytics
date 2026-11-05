import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./en";
import { ptBR } from "./pt-BR";

type Deep<T> = { [K in keyof T]: T[K] extends string ? string : Deep<T[K]> };
export type Messages = Deep<typeof en>;

type Join<K, P> = K extends string ? (P extends string ? `${K}.${P}` : never) : never;
type Paths<T> = { [K in keyof T]: T[K] extends string ? K : Join<K, Paths<T[K]>> }[keyof T];
export type MessageKey = Paths<Messages>;

/** To add a locale, create a `Messages` dictionary and register it here. */
export const LOCALES = [
  { code: "en", label: "English", messages: en as Messages },
  { code: "pt-BR", label: "Português (Brasil)", messages: ptBR },
] as const;
export type Locale = (typeof LOCALES)[number]["code"];

const STORE_KEY = "fa_locale";
const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.code === v);

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* no storage */ }
  for (const lang of navigator.languages ?? [navigator.language]) {
    const exact = LOCALES.find((l) => l.code.toLowerCase() === lang.toLowerCase());
    if (exact) return exact.code;
    const base = LOCALES.find((l) => l.code.split("-")[0] === lang.split("-")[0].toLowerCase());
    if (base) return base.code;
  }
  return "en";
}

function lookup(messages: Messages, key: string): string {
  let v: any = messages;
  for (const part of key.split(".")) v = v?.[part];
  return typeof v === "string" ? v : key;
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale, persist?: boolean) => void;
  t: Translate;
  /** Translates an API error code (with optional details). */
  te: (code: string, detail?: Record<string, string>) => string;
  nf: Intl.NumberFormat;
}

const Ctx = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);
  const messages = LOCALES.find((l) => l.code === locale)!.messages;

  const setLocale = useCallback((l: Locale, persist = true) => {
    if (!isLocale(l)) return;
    setLocaleState(l);
    if (persist) {
      try { localStorage.setItem(STORE_KEY, l); } catch { /* no storage */ }
    }
  }, []);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const value = useMemo<I18nValue>(() => {
    const t: Translate = (key, vars) => {
      let s = lookup(messages, key);
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    };
    const te = (code: string, detail?: Record<string, string>) => {
      const key = `errors.${code}`;
      const s = lookup(messages, key);
      return s === key ? t("errors.generic") : t(key as MessageKey, detail);
    };
    return { locale, setLocale, t, te, nf: new Intl.NumberFormat(locale) };
  }, [locale, messages, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n fora do I18nProvider");
  return v;
}
