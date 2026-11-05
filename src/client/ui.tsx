import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconAlertTriangle, IconCheck, IconCircleCheck, IconCopy, IconDots, IconEye, IconEyeOff, IconFlare, IconInfoCircle, IconX,
} from "@tabler/icons-react";
import { useI18n } from "./i18n";

/** Joins classes, skipping falsy values. */
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Shared classes ----------

type Variant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON_VARIANTS: Record<Variant, string> = {
  primary: "border-transparent bg-accent text-accent-ink not-disabled:hover:bg-accent-hover not-disabled:hover:text-accent-ink",
  secondary: "border-border-strong bg-surface text-ink not-disabled:hover:bg-surface-2 not-disabled:hover:text-ink",
  ghost: "border-transparent bg-transparent text-accent not-disabled:hover:bg-accent-soft",
  danger: "border-danger bg-surface text-danger not-disabled:hover:bg-danger-soft",
};
/** Button classes, also for <a>. */
export const buttonCls = (variant: Variant = "secondary") => cn(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-md leading-[1.2] font-medium no-underline",
  "transition-colors duration-120 ease-out disabled:cursor-not-allowed disabled:opacity-55 aria-busy:cursor-progress",
  BUTTON_VARIANTS[variant],
);

export const iconBtnCls = cn(
  "inline-grid size-10 place-items-center rounded-lg border border-transparent text-ink-2",
  "hover:bg-surface-2 hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent",
);

const controlCls = cn(
  "min-h-10 rounded-lg border border-border-strong bg-surface py-2 pl-3 text-md placeholder:text-muted",
  "hover:border-muted focus-visible:border-accent focus-visible:outline-offset-0 aria-invalid:border-danger [&[readonly]]:bg-surface-2",
);
export const inputCls = cn(controlCls, "w-full pr-3");
/** Content-width input (dates). */
export const inputAutoCls = cn(controlCls, "pr-3");
export const selectCls = cn(controlCls, "w-full cursor-pointer pr-8");
export const checkboxCls = "m-0 size-[18px] flex-none accent-accent";

export const labelCls = "text-sm font-semibold text-ink";
export const hintCls = "text-sm text-muted";
export const linkCls = "cursor-pointer text-left text-accent underline";

const panelBoxCls = "min-w-0 rounded-lg border border-border bg-surface";
export const panelCls = cn(panelBoxCls, "p-5 max-xs:p-4");
export const panelBareCls = panelBoxCls;
export const panelTitleCls = "text-base font-semibold";

export const pageHeadCls = "mb-5 flex flex-wrap items-end justify-between gap-4 max-xs:mb-4 max-xs:gap-3";
export const pageTitleCls = "text-[26px] leading-normal font-[650] tracking-[-0.015em] [overflow-wrap:anywhere] max-nav:text-[22px]";
export const emptyCls = "px-2 py-7 text-center text-md text-muted";
export const chartBoxCls = "relative h-[300px] px-3 pt-1 pb-3 max-xs:h-[240px] max-xs:px-1 max-xs:pb-2";
export const numCls = "text-right whitespace-nowrap tabular-nums";
export const thCls = "text-sm font-semibold text-muted";

// ---------- Components ----------

export function Button({ variant = "secondary", busy, children, className = "", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button {...rest} className={cn(buttonCls(variant), className)} aria-busy={busy || undefined} disabled={rest.disabled || busy}>
      {children}
    </button>
  );
}

export function Field({ label, hint, error, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string }) {
  const id = useId();
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const isPassword = input.type === "password";
  const control = (
    <input id={id} {...input} type={isPassword && shown ? "text" : input.type} aria-invalid={!!error || undefined}
      aria-describedby={hint || error ? `${id}-hint` : undefined} className={isPassword ? cn(controlCls, "w-full pr-12") : inputCls} />
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelCls}>{label}</label>
      {isPassword ? (
        <div className="relative">
          {control}
          <button type="button" onClick={() => setShown((s) => !s)}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
            aria-pressed={shown} aria-label={shown ? t("app.hidePassword") : t("app.showPassword")}>
            {shown ? <IconEyeOff size={20} aria-hidden="true" /> : <IconEye size={20} aria-hidden="true" />}
          </button>
        </div>
      ) : control}
      {(hint || error) && <p id={`${id}-hint`} className={error ? "text-sm text-danger" : hintCls}>{error ?? hint}</p>}
    </div>
  );
}

const NOTICE_TONES = {
  info: { box: "bg-info-soft border-accent/35", icon: "text-accent", Icon: IconInfoCircle },
  error: { box: "bg-danger-soft border-danger/40", icon: "text-danger", Icon: IconAlertTriangle },
  success: { box: "bg-success-soft border-good/40", icon: "text-good", Icon: IconCircleCheck },
  warning: { box: "bg-warning-soft border-warning/45", icon: "text-warning", Icon: IconAlertTriangle },
};

export function Notice({ tone = "info", children }: { tone?: keyof typeof NOTICE_TONES; children: ReactNode }) {
  const { box, icon, Icon } = NOTICE_TONES[tone];
  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-md", box)} role={tone === "error" ? "alert" : "status"}>
      <Icon size={20} stroke={1.75} aria-hidden="true" className={cn("mt-px flex-none", icon)} />
      <div className="flex min-w-0 flex-col items-start gap-1">{children}</div>
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={cn(inputCls, "min-w-0 flex-1 font-mono text-sm")} />
        <Button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* no permission */ }
        }}>
          {copied ? <IconCheck size={18} aria-hidden="true" /> : <IconCopy size={18} aria-hidden="true" />}
          {copied ? t("app.copied") : t("app.copy")}
        </Button>
      </div>
    </div>
  );
}

/** Status label with a colored dot (good / needs improvement / poor). */
export function StatusBadge({ tone, title, children }: { tone: "good" | "ni" | "poor" | null; title?: string; children: ReactNode }) {
  const dot = tone === "good" ? "bg-good" : tone === "ni" ? "bg-warning" : tone === "poor" ? "bg-poor" : "bg-muted";
  return (
    <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink" title={title}>
      <span className={cn("size-2.5 flex-none rounded-full", dot)} aria-hidden="true" />{children}
    </span>
  );
}
/**
 * Native <dialog>: focus trapped, Esc closes, background inert. Programmatic closes (unmount,
 * including StrictMode's double mount) don't call onClose. Focus returns to the opener.
 */
export function Dialog({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const programmatic = useRef(false);
  // The opener, captured on first render before focus moves into the <dialog>.
  const opener = useRef(document.activeElement as HTMLElement | null);
  const titleId = useId();
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => {
      programmatic.current = true;
      if (d.open) d.close();
      const el = opener.current;
      // Restore focus after React finishes unmounting.
      setTimeout(() => { if (el?.isConnected) el.focus(); }, 0);
    };
  }, []);
  return (
    <dialog ref={ref} className={cn(
        "m-auto max-h-[calc(100vh-48px)] rounded-xl border border-border bg-surface p-0 text-ink shadow-popover backdrop:bg-black/45 open:flex open:flex-col",
        wide ? "w-[min(720px,calc(100vw-32px))]" : "w-[min(480px,calc(100vw-32px))]",
      )} aria-labelledby={titleId}
      onClose={() => {
        // "close" is async: one from a programmatic close arrives later and is ignored here.
        if (programmatic.current) { programmatic.current = false; if (!ref.current?.open) ref.current?.showModal(); return; }
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <button className={iconBtnCls} onClick={onClose} aria-label={t("app.close")}><IconX size={20} aria-hidden="true" /></button>
      </header>
      <div className="flex flex-col gap-4 overflow-y-auto p-5">{children}</div>
      {footer && <footer className="flex justify-end gap-3 border-t border-border px-5 py-4 max-xs:flex-wrap">{footer}</footer>}
    </dialog>
  );
}

export interface TabDef<K extends string> { key: K; label: string }

/**
 * Accessible tabs: arrows move the selection; each tab controls `${id}-panel`.
 * On mobile they become a full-width segmented control.
 */
export function Tabs<K extends string>({ tabs, value, onChange, label, id }: {
  tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; label: string; id: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const jump = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (!dir && jump == null) return;
    e.preventDefault();
    const next = jump ?? (i + dir + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div className="flex flex-wrap gap-1 max-xs:flex-nowrap max-xs:rounded-lg max-xs:bg-surface-2 max-xs:p-[3px]" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button key={tab.key} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" id={`${id}-tab-${tab.key}`}
          aria-selected={value === tab.key} aria-controls={`${id}-panel`} tabIndex={value === tab.key ? 0 : -1}
          onClick={() => onChange(tab.key)} onKeyDown={(e) => onKey(e, i)}
          className={cn(
            "rounded-md px-2.5 py-1.5 text-md whitespace-nowrap max-xs:min-w-0 max-xs:flex-1 max-xs:px-1 max-xs:text-center max-xs:text-sm",
            value === tab.key ? "bg-accent-soft font-semibold text-accent" : "font-medium text-ink-2 hover:bg-surface-2 hover:text-ink",
          )}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** Floating action menu (escapes scroll containers) with menu semantics and keys. */
export function Menu({ label, items }: { label: string; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const menuId = useId();

  const close = (focusButton = true) => { setOpen(false); if (focusButton) button.current?.focus(); };

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current!.getBoundingClientRect();
      const height = list.current?.offsetHeight ?? 0;
      const below = r.bottom + 4 + height <= window.innerHeight;
      setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height), right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    list.current?.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
  };

  return (
    <>
      <button ref={button} className={iconBtnCls} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={label} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}>
        <IconDots size={20} aria-hidden="true" />
      </button>
      {open && createPortal(
        <ul ref={list} id={menuId} className="fixed z-40 m-0 min-w-60 rounded-lg border border-border bg-surface p-1.5 shadow-popover" role="menu" aria-label={label} onKeyDown={onKey}
          style={{ top: pos?.top ?? -9999, right: pos?.right ?? 0 }}>
          {items.map((i) => (
            <li key={i.label} role="none">
              <button role="menuitem" tabIndex={-1} className={cn("block w-full rounded-md px-2.5 py-2 text-left text-md hover:bg-surface-2 focus-visible:bg-surface-2", i.danger && "text-danger")} onClick={() => { close(); i.onClick(); }}>
                {i.label}
              </button>
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </>
  );
}

export const FlareMark = ({ size = 28 }: { size?: number }) => (
  <span className="inline-grid flex-none place-items-center text-brand" style={{ width: size, height: size }}>
    <IconFlare size={size * 0.68} stroke={2} aria-hidden="true" />
  </span>
);

export function Spinner() {
  const { t } = useI18n();
  return <div className="mx-auto my-8 size-7 animate-[spin_800ms_linear_infinite] rounded-full border-3 border-surface-3 border-t-accent" role="status"><span className="sr-only">{t("app.loading")}</span></div>;
}

