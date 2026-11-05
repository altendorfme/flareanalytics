import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useI18n, type MessageKey } from "./i18n";
import { labelCls, selectCls } from "./ui";

export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORE_KEY = "fa_theme";
const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);
/** Fired on manual theme change so the chart rereads colors. */
export const THEME_EVENT = "fa-themechange";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isTheme(saved)) return saved;
  } catch { /* no storage */ }
  return "auto";
}

/** "auto" follows the system; "light"/"dark" force it via data-theme. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "auto" ? "light dark" : theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

interface ThemeValue { theme: Theme; setTheme: (t: Theme) => void }
const Ctx = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const setTheme = useCallback((t: Theme) => {
    if (!isTheme(t)) return;
    setThemeState(t);
    try { localStorage.setItem(STORE_KEY, t); } catch { /* no storage */ }
  }, []);
  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTheme fora do ThemeProvider");
  return v;
}

const LABELS: Record<Theme, MessageKey> = { auto: "app.themeAuto", light: "app.themeLight", dark: "app.themeDark" };

export function ThemeSelect() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  return (
    <label className="flex flex-col gap-1.5">
      <span className={labelCls}>{t("app.theme")}</span>
      <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)} className={selectCls}>
        {THEMES.map((th) => <option key={th} value={th}>{t(LABELS[th])}</option>)}
      </select>
    </label>
  );
}
