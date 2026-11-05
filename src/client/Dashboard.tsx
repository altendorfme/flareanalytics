import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { IconAlertTriangle, IconArrowDownRight, IconArrowUpRight, IconMinus, IconTable, IconChartBar } from "@tabler/icons-react";
import { ApiError, fetchOverview, fetchTop, type Dim, type Overview, type Row, type SiteInfo } from "./api";
import { useI18n, type MessageKey } from "./i18n";
import { agentName, delta, fillSeries, formatters, localToday, nextCollection, partialBucket, PERIOD_KEYS, STALE_MS, periodRange, project, tickLabel, type Formatters, type PeriodKey } from "./format";
import { navigate, onLinkClick, useLocation } from "./router";
import { useSites } from "./Shell";
import { useSession } from "./session";
import { BrowserIcon, ChannelIcon, DeviceIcon, Favicon, Flag, OsIcon } from "./icons";
// ECharts loads only when a chart appears.
type StaleSpan = import("./TrafficChart").StaleSpan;
const TrafficChart = lazy(() => import("./TrafficChart").then((m) => ({ default: m.TrafficChart })));
import {
  Button, chartBoxCls, cn, Dialog, emptyCls, iconBtnCls, inputAutoCls, inputCls, labelCls, linkCls, Notice, numCls, pageHeadCls,
  pageTitleCls, panelBareCls, panelCls, panelTitleCls, selectCls, Spinner, StatusBadge, Tabs, thCls,
} from "./ui";
import { useTitle } from "./useTitle";

// ---------- Period (kept in the URL for shareable links) ----------

export function usePeriod() {
  const { search } = useLocation();
  const { timeZone } = useSites();
  const q = new URLSearchParams(search);
  const period = (PERIOD_KEYS.includes(q.get("period") as PeriodKey) ? q.get("period") : "7d") as PeriodKey;
  const today = localToday(timeZone);
  const from = q.get("from"), to = q.get("to");
  const custom = period === "custom" && from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const range = custom ? { from: from!, to: to! } : periodRange(period, today);
  // Push a history entry so Back undoes a period change.
  const set = (p: PeriodKey, r?: { from: string; to: string }) => {
    const n = new URLSearchParams(location.search);
    n.set("period", p);
    if (p === "custom" && r) { n.set("from", r.from); n.set("to", r.to); } else { n.delete("from"); n.delete("to"); }
    navigate(`${location.pathname}?${n}`);
  };
  return { period, range, today, set };
}

export function PeriodPicker() {
  const { t } = useI18n();
  const { period, range, today, set } = usePeriod();
  const [draft, setDraft] = useState(range);
  useEffect(() => setDraft(range), [range.from, range.to]);
  return (
    <div className="flex flex-wrap items-end gap-3 max-xs:w-full">
      <label className="max-xs:w-full">
        <span className="sr-only">{t("periods.label")}</span>
        <select value={period} onChange={(e) => set(e.target.value as PeriodKey, range)} className={cn(selectCls, "min-w-[200px] font-medium max-xs:min-w-0")}>
          {PERIOD_KEYS.map((k) => <option key={k} value={k}>{t(`periods.${k}` as MessageKey)}</option>)}
        </select>
      </label>
      {period === "custom" && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.from <= draft.to) set("custom", draft); }}>
          <label className="flex flex-col gap-1"><span className={labelCls}>{t("periods.from")}</span>
            <input type="date" value={draft.from} max={today} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} required className={inputAutoCls} />
          </label>
          <label className="flex flex-col gap-1"><span className={labelCls}>{t("periods.to")}</span>
            <input type="date" value={draft.to} max={today} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} required className={inputAutoCls} />
          </label>
          <Button type="submit">{t("periods.apply")}</Button>
        </form>
      )}
    </div>
  );
}


/**
 * Data freshness. Pulsing orange = current; late = no pulse, warning color, relative time and
 * (for admins) a link to Status.
 */
const freshCls = "mt-1 flex items-center gap-2 text-sm text-muted";

export function Freshness() {
  const { t, locale } = useI18n();
  const { me } = useSession();
  const { lastRun, timeZone, sites } = useSites();
  const f = formatters(locale);
  if (!lastRun) {
    const key = sites.some((s) => s.first_day) ? "dashboard.importedWaiting" : "dashboard.neverCollected";
    return (
      <p className={freshCls}>
        <span className="size-2 rounded-full bg-border-strong" aria-hidden="true" />
        {t(key, { time: f.clock(nextCollection(), timeZone) })}
      </p>
    );
  }
  const last = new Date(lastRun);
  const stale = Date.now() - last.getTime() > STALE_MS;
  if (stale) {
    return (
      // Icon pinned to the first line; text and link wrap together as one sentence.
      <p className="mt-1 flex items-start gap-2 text-sm font-medium text-ink" role="status">
        <IconAlertTriangle size={16} stroke={2} aria-hidden="true" className="mt-[3px] flex-none text-warning" />
        <span>
          {t("dashboard.stale", { ago: f.ago(last) })}{" "}
          {me?.role === "admin"
            ? <a href="/settings/status" onClick={onLinkClick} className="font-medium whitespace-nowrap">{t("dashboard.checkStatus")}</a>
            : t("dashboard.staleMember")}
        </span>
      </p>
    );
  }
  const next = nextCollection();
  const sameDay = f.localDate(last, timeZone) === f.localDate(new Date(), timeZone);
  const updated = sameDay
    ? t("dashboard.updated", { time: f.clock(last, timeZone) })
    : t("dashboard.updatedOn", { date: f.date(f.localDate(last, timeZone), { day: "numeric", month: "short" }), time: f.clock(last, timeZone) });
  return (
    <p className={freshCls}>
      <span className="size-2 animate-fresh-pulse rounded-full bg-fresh motion-reduce:animate-none" aria-hidden="true" />
      {updated} · {t("dashboard.nextCollection", { time: f.clock(next, timeZone) })}
    </p>
  );
}

function PageHead({ site, children }: { site: SiteInfo; children?: ReactNode }) {
  return (
    <header className={pageHeadCls}>
      <div>
        <h1 className={pageTitleCls}>{site.host}</h1>
        <Freshness />
      </div>
      {children}
    </header>
  );
}

function useOverview(site: string) {
  const { te } = useI18n();
  const { range } = usePeriod();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetchOverview(site, range.from, range.to)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(te(e instanceof ApiError ? e.code : "generic")))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [site, range.from, range.to, tick, te]);
  return { data, error, loading, retry: () => setTick((n) => n + 1) };
}

function useSite(tag: string) {
  const { sites } = useSites();
  return sites.find((s) => s.site_tag === tag) ?? null;
}

export function NoSites() {
  const { t } = useI18n();
  const { me } = useSession();
  return (
    <div className="mx-auto my-16 flex max-w-[560px] flex-col items-center gap-3 text-center">
      <h1 className="text-[24px] font-[650]">{t("dashboard.noSitesTitle")}</h1>
      <p>{me?.role === "admin" ? t("dashboard.noSitesAdmin") : t("dashboard.noSitesMember")}</p>
      {me?.role === "admin" && <Button variant="primary" onClick={() => navigate("/settings/cloudflare")}>{t("dashboard.openSettings")}</Button>}
    </div>
  );
}

// ---------- Traffic ----------

/** Large figures (metric tabs, overview, Web Vitals). */
export const bigNumberCls = "text-[30px] font-[650] tracking-[-0.02em] tabular-nums";
export const metricLabelCls = "text-md font-medium text-ink-2 max-xs:text-sm";
const footnoteCls = "mt-7 flex max-w-[68ch] flex-col gap-1.5 text-sm text-muted";
const chartThCls = cn(thCls, "sticky top-0 border-b border-grid bg-surface px-3 py-2");
const chartTdCls = "border-b border-grid px-3 py-2";

export interface PartialBucket { index: number; actual: number; projected: number | null; asOf: Date; elapsedMin: number }

type Metric = "pageviews" | "visits" | "vpv";
const METRICS: readonly Metric[] = ["visits", "pageviews", "vpv"];

export function TrafficPage({ siteTag }: { siteTag: string }) {
  const { t, locale } = useI18n();
  const site = useSite(siteTag);
  const { timeZone, lastRun } = useSites();
  const { range, today } = usePeriod();
  const { data, error, loading, retry } = useOverview(siteTag);
  useTitle(site?.host, t("nav.traffic"));
  // Visits first, matching the Overview sort.
  // Metric and table view live in the URL; switching replaces the history entry
  // instead of stacking one Back per click.
  const { search } = useLocation();
  const qs = new URLSearchParams(search);
  const metric: Metric = METRICS.includes(qs.get("metric") as Metric) ? (qs.get("metric") as Metric) : "visits";
  const asTable = qs.get("view") === "table";
  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(location.search);
    if (v == null) n.delete(k); else n.set(k, v);
    const q = n.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ""}`, true);
  };
  const setMetric = (m: Metric) => setParam("metric", m === "visits" ? null : m);
  const metricRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const f = useMemo(() => formatters(locale), [locale]);

  const chart = useMemo(() => {
    if (!data) return null;
    const { unit, from, to } = data.range;
    const lastMs = lastRun ? Date.parse(lastRun) : null;
    // Late collection in a period reaching today: the axis runs to now and the uncollected span is marked.
    const late = lastMs != null && to === today && Date.now() - lastMs > STALE_MS;
    const filled = fillSeries(data.series, unit, from, to, timeZone, late ? Date.now() : lastMs ?? Date.now());
    let staleIndex: number | null = null;
    if (late) {
      const key = unit === "hour"
        ? new Date(Math.floor(lastMs / 3_600_000) * 3_600_000).toISOString().replace(".000Z", "Z")
        : f.localDate(new Date(lastMs), timeZone);
      const i = filled.findIndex((p) => p.t === key);
      staleIndex = i >= 0 ? i : filled.length && filled[0].t > key ? 0 : null;
      // Today's total minus closed hours goes to the hour that was being collected.
      if (staleIndex != null) partialBucket(filled.slice(0, staleIndex + 1), unit, from, to, today, data.summary.current, lastRun, timeZone);
    }
    // In-progress hour: today's total so far minus closed hours.
    const bucket = late ? null : partialBucket(filled, unit, from, to, today, data.summary.current, lastRun, timeZone);
    const partialIndex = bucket?.index ?? null;
    const value = (p: { pageviews: number; visits: number }) =>
      metric === "vpv" ? (p.visits ? p.pageviews / p.visits : 0) : p[metric];
    // Previous period aligned by position.
    const prevFilled = fillSeries(data.previousSeries ?? [], unit, data.range.prevFrom, data.range.prevTo, timeZone);
    // Coleta atrasada no gráfico diário: hoje vai só até a última coleta, então o dia equivalente do
    // período anterior também para nessa hora (os totais já fazem o mesmo corte).
    const cutPrev = late && unit === "day" && data.previousCut != null && staleIndex != null && prevFilled[staleIndex]?.t === data.range.prevTo;
    if (cutPrev) prevFilled[staleIndex!] = { ...prevFilled[staleIndex!], ...data.previousCut! };
    const previous = filled.map((_, i) => (prevFilled[i] ? value(prevFilled[i]) : null));
    const points = filled.map((p) => ({ t: p.t, value: value(p) }));

    // Project the in-progress bucket at the current pace. Ratios aren't projected.
    let partial: PartialBucket | null = null;
    if (bucket) {
      const actual = points[bucket.index].value;
      partial = { index: bucket.index, actual, projected: metric === "vpv" ? null : project(actual, bucket.fraction), asOf: bucket.asOf, elapsedMin: bucket.elapsedMin };
    }
    let stale: StaleSpan | null = null;
    if (staleIndex != null && lastMs != null) {
      const time = f.clock(new Date(lastMs), timeZone);
      stale = {
        index: staleIndex,
        label: t("dashboard.uncollectedSince", { time }),
        partialLabel: t("dashboard.collectedUntil", { time }),
        legend: t("dashboard.partialLegend", { time }),
        note: t("dashboard.uncollectedNote", { time }),
        partialNote: t("dashboard.partialStale", {
          time, value: (metric === "vpv" ? f.dec : f.num)(points[staleIndex].value), unit: unit === "hour" ? t("dashboard.unitHour") : t("dashboard.unitDay"),
        }) + (cutPrev ? ` ${t("dashboard.partialStalePrev", { time })}` : ""),
      };
    }
    return { unit, partialIndex, partial, previous, points, stale };
  }, [data, metric, timeZone, today, lastRun, f, t]);

  const late = useLate(data?.range.to);
  if (!site) return <NoSites />;
  const cur = data?.summary.current ?? { pageviews: 0, visits: 0 };
  const prev = data?.summary.previous ?? { pageviews: 0, visits: 0 };
  const vpv = (x: { pageviews: number; visits: number }) => (x.visits ? x.pageviews / x.visits : 0);
  const metrics: { key: Metric; label: string; short?: string; value: number; prev: number; fmt: (n: number) => string }[] = [
    { key: "visits", label: t("dashboard.visits"), value: cur.visits, prev: prev.visits, fmt: f.num },
    { key: "pageviews", label: t("dashboard.pageviews"), value: cur.pageviews, prev: prev.pageviews, fmt: f.num },
    { key: "vpv", label: t("dashboard.viewsPerVisit"), short: t("dashboard.viewsPerVisitShort"), value: vpv(cur), prev: vpv(prev), fmt: f.dec },
  ];
  const active = metrics.find((m) => m.key === metric)!;
  const empty = data && cur.pageviews === 0 && data.series.length === 0;
  const compare = data ? compareLabel(data.range, t, f, timeZone, late) : "";

  return (
    <>
      <PageHead site={site}><PeriodPicker /></PageHead>
      <p className="sr-only" role="status" aria-live="polite">{data && !loading
        ? t("dashboard.totalsAnnounce", { range: f.range(data.range.from, data.range.to), visits: f.full(cur.visits), pageviews: f.full(cur.pageviews) })
        : ""}</p>
      {error && <Notice tone="error">{error} <button className={linkCls} onClick={retry}>{t("app.retry")}</button></Notice>}

      {/* Stale data dims while new data loads. */}
      <section className={cn(panelBareCls, "mb-5 transition-opacity duration-200", loading && data && "opacity-60")} aria-busy={loading}>
        <div className="grid grid-cols-3 border-b border-border" role="tablist" aria-label={t("dashboard.metrics")}>
          {metrics.map((m, i) => (
            <button key={m.key} ref={(el) => { metricRefs.current[i] = el; }} role="tab" type="button" id={`metric-tab-${m.key}`}
              aria-selected={metric === m.key} aria-controls="metric-panel" tabIndex={metric === m.key ? 0 : -1}
              className={cn(
                "-mb-px flex flex-col items-start gap-0.5 border-b-3 px-5 pt-4 pb-3.5 text-left hover:bg-surface-2",
                "first:rounded-tl-lg last:rounded-tr-lg not-first:border-l not-first:border-l-border max-xs:px-3 max-xs:pt-3 max-xs:pb-2.5",
                metric === m.key ? "border-b-accent forced-colors:border-b-[Highlight]" : "border-b-transparent",
              )}
              onClick={() => setMetric(m.key)}
              onKeyDown={(e) => {
                // Same keys as Tabs: arrows cycle, Home/End jump to the ends.
                const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                const jump = e.key === "Home" ? 0 : e.key === "End" ? metrics.length - 1 : null;
                if (!dir && jump == null) return;
                e.preventDefault();
                const next = jump ?? (i + dir + metrics.length) % metrics.length;
                setMetric(metrics[next].key);
                metricRefs.current[next]?.focus();
              }}>
              <span className={cn("text-md max-xs:text-sm", metric === m.key ? "font-semibold text-accent" : "font-medium text-ink-2")}>{m.short
                ? <><span className="max-xs:sr-only">{m.label}</span><span className="hidden max-xs:inline" aria-hidden="true">{m.short}</span></>
                : m.label}</span>
              <span className={cn(bigNumberCls, "leading-[1.2] max-xs:text-[22px]")}>{data ? m.fmt(m.value) : "—"}</span>
              <Delta cur={m.value} prev={m.prev} f={f} counts={m.key !== "vpv"} late={late} />
            </button>
          ))}
        </div>
        <div id="metric-panel" role="tabpanel" aria-labelledby={`metric-tab-${metric}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-3 max-xs:px-3">
          <div className="flex flex-col gap-1"><CompareLine text={compare} late={late} /></div>
          <div className="flex flex-wrap items-center gap-3">
            {chart?.partialIndex != null && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2"><i className="h-0 w-[18px] border-t-2 border-dashed border-fresh" aria-hidden="true" />{t("dashboard.inProgress")}</span>
            )}
            {chart?.stale && !empty && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <i className="h-0 w-[18px] border-t-2 border-dotted border-series-1" aria-hidden="true" />{chart.stale.legend}
              </span>
            )}
            {chart?.stale && !empty && chart.stale.index < chart.points.length - 1 && (
              <span className="inline-flex items-center gap-2 text-sm text-ink-2">
                <i className="h-3 w-[18px] rounded-[2px] border border-muted bg-[repeating-linear-gradient(135deg,var(--text-muted)_0_1px,transparent_1px_4px)]" aria-hidden="true" />
                {t("dashboard.uncollected")}
              </span>
            )}
            <button className={iconBtnCls} onClick={() => setParam("view", asTable ? null : "table")} aria-pressed={asTable}
              aria-label={asTable ? t("dashboard.showChart") : t("dashboard.showTable")} title={asTable ? t("dashboard.showChart") : t("dashboard.showTable")}>
              {asTable ? <IconChartBar size={20} aria-hidden="true" /> : <IconTable size={20} aria-hidden="true" />}
            </button>
          </div>
        </div>
        {!data && loading && <div className={chartBoxCls}><Spinner /></div>}
        {empty && (
          <div className={cn(chartBoxCls, "flex flex-col items-center justify-center gap-1 text-center")}><p><strong>{t("dashboard.noData")}</strong></p><p className="text-muted">{t("dashboard.noDataHint")}</p></div>
        )}
        {chart && !empty && (asTable ? (
          <div className="relative mx-5 mt-2 mb-5 max-h-[340px] overflow-auto rounded-lg border border-border">
            <table className="w-full text-md">
              <thead><tr>
                <th scope="col" className={cn(chartThCls, "text-left")}>{t("dashboard.time")}</th>
                <th scope="col" className={cn(chartThCls, numCls)}>{active.label}</th>
                <th scope="col" className={cn(chartThCls, numCls)}>{t("dashboard.previousPeriod")}</th>
              </tr></thead>
              <tbody>
                {chart.points.map((p, i) => (
                  <tr key={p.t}>
                    <td className={chartTdCls}>{tickLabel(p.t, chart.unit, timeZone, locale)}{i === chart.partialIndex ? ` · ${t("dashboard.inProgress")}` : ""}</td>
                    <td className={cn(chartTdCls, numCls)}>{chart.stale && i > chart.stale.index
                      ? <span className="text-muted">— · {t("dashboard.uncollected")}</span>
                      : chart.stale && i === chart.stale.index
                      ? <>{active.fmt(p.value)} <span className="text-muted">· {chart.stale.partialLabel}</span></>
                      : i === chart.partial?.index && chart.partial.projected != null
                      ? <>{active.fmt(p.value)} <span className="text-muted">· {t("dashboard.projected")} {active.fmt(chart.partial.projected)}</span></>
                      : active.fmt(p.value)}</td>
                    <td className={cn(chartTdCls, numCls)}>{chart.previous[i] == null ? "—" : active.fmt(chart.previous[i]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Suspense fallback={<div className={chartBoxCls}><Spinner /></div>}>
          <TrafficChart points={chart.points} previous={chart.previous} unit={chart.unit}
            currentLabel={t("dashboard.current")} previousLabel={t("dashboard.previousPeriod")} timeZone={timeZone} locale={locale}
            label={chart.stale ? `${t("dashboard.chartLabel", { metric: active.label })}. ${chart.stale.label}.` : t("dashboard.chartLabel", { metric: active.label })}
            format={active.fmt} integer={metric !== "vpv"} stale={chart.stale}
            partial={chart.partial} partialNote={(b) => b.projected == null ? t("dashboard.inProgressHint") : t("dashboard.projectedNote", {
              value: active.fmt(b.actual), time: f.clock(b.asOf, timeZone),
              elapsed: chart.unit === "hour" ? `${b.elapsedMin} min` : f.dec(b.elapsedMin / 60) + " h",
              unit: chart.unit === "hour" ? t("dashboard.unitHour") : t("dashboard.unitDay"),
            })} projectedLabel={t("dashboard.projected")} />
          </Suspense>
        ))}
        </div>
      </section>

      {data && <div className={cn("transition-opacity duration-200", loading && "opacity-60")} aria-busy={loading}><Breakdowns data={data} site={site} f={f} range={range} /></div>}

      <footer className={footnoteCls}>
        <p>{t("dashboard.footnote")}</p>
        {site.first_day && <p>{t("dashboard.historySince", { date: f.date(site.first_day) })}</p>}
      </footer>
    </>
  );
}

/**
 * "vs. Nov 3 until 14:35": how far the previous period was counted. In multi-day periods only
 * the last day is cut, and the text says so.
 */
export function compareLabel(
  r: { prevFrom: string; prevTo: string; days: number; partialCompare: boolean; compareUntil: string | null },
  t: ReturnType<typeof useI18n>["t"], f: Formatters, timeZone: string, late = false,
) {
  const range = f.range(r.prevFrom, r.prevTo);
  if (!r.partialCompare || !r.compareUntil) return t("dashboard.vsPrevious", { range });
  const hour = f.clock(new Date(r.compareUntil), timeZone);
  // Late collection: both sides stop at the last collection, and the text says so.
  if (late) return t(r.days > 1 ? "dashboard.vsPreviousLateDay" : "dashboard.vsPreviousLate", { range, hour });
  return t(r.days > 1 ? "dashboard.vsPreviousUntilDay" : "dashboard.vsPreviousUntil", { range, hour });
}

/** Late collection in a period reaching today: numbers stop at the last collection. */
export function useLate(to: string | undefined) {
  const { lastRun } = useSites();
  const { today } = usePeriod();
  return !!lastRun && to === today && Date.now() - Date.parse(lastRun) > STALE_MS;
}

/** Comparison line; when late it gets ink and says the comparison is still fair. */
export function CompareLine({ text, late }: { text: string; late: boolean }) {
  return <p className={cn("text-sm", late ? "font-medium text-ink-2" : "text-muted")}>{text}</p>;
}

const deltaCls = "inline-flex items-center gap-1 text-sm tabular-nums";
const DELTA_TONES = {
  up: "font-semibold text-good",
  down: "font-semibold text-poor",
  flat: "font-medium text-muted",
  /** Small base: absolute difference, no alarm color. */
  quiet: "font-medium text-ink-2",
};

/** Below this base a percentage overstates the change, so show the absolute difference. */
const SMALL_BASE = 100;

/** `late`: both sides stop at the last collection, so the comparison is fair but shown without alarm. */
export function Delta({ cur, prev, f, counts, late, invert }: {
  cur: number; prev: number; f: Formatters; counts?: boolean; late?: boolean;
  /** Lower is better (Web Vitals): a fall is the good news. */
  invert?: boolean;
}) {
  const { t } = useI18n();
  const d = delta(cur, prev);
  if (d == null) return <span className={cn(deltaCls, DELTA_TONES.flat)}>{t("dashboard.noBase")}</span>;
  const absolute = counts && prev < SMALL_BASE;
  const diff = cur - prev;
  const dir = absolute ? (Math.round(diff) > 0 ? "up" : Math.round(diff) < 0 ? "down" : "flat") : d > 0.5 ? "up" : d < -0.5 ? "down" : "flat";
  const Icon = dir === "up" ? IconArrowUpRight : dir === "down" ? IconArrowDownRight : IconMinus;
  const value = absolute ? f.full(Math.abs(diff)) : f.pct(Math.abs(d));
  return (
    <span className={cn(deltaCls, absolute || late ? DELTA_TONES.quiet : DELTA_TONES[invert && dir !== "flat" ? (dir === "up" ? "down" : "up") : dir])}>
      {/* 18px at stroke 2.25: the direction must still read next to 24-30px numbers in the quiet tone. */}
      <Icon size={18} stroke={2.25} aria-hidden="true" className="flex-none" />
      <span aria-hidden="true">{dir === "flat" ? (absolute ? "0" : "0%") : absolute ? t(dir === "up" ? "dashboard.absMore" : "dashboard.absFewer", { value }) : value}</span>
      <span className="sr-only">{dir === "up" ? t("dashboard.up", { value }) : dir === "down" ? t("dashboard.down", { value }) : t("dashboard.flat")}</span>
    </span>
  );
}

// ---------- Breakdowns ----------

/**
 * Long paths: cut the middle and keep the last segment (the slug), which tells pages apart.
 * Cutting at the end made every row look the same on mobile. Screen readers read both parts.
 */
function MiddleEllipsis({ text }: { text: string }) {
  const cut = text.lastIndexOf("/", text.length - 2);
  if (cut <= 0) return <span className="min-w-0 truncate">{text}</span>;
  // On a phone both halves would truncate ("/p/o… /reuniao-de-e…"): drop the prefix to an ellipsis
  // and give the slug the whole cell. Screen readers get the full path once.
  return (
    <span className="flex min-w-0">
      <span className="sr-only">{text}</span>
      <span className="min-w-0 truncate max-xs:hidden" aria-hidden="true">{text.slice(0, cut)}</span>
      <span className="hidden flex-none text-muted max-xs:inline" aria-hidden="true">…</span>
      <span className="max-w-[70%] shrink-0 truncate max-xs:max-w-none max-xs:shrink" aria-hidden="true">{text.slice(cut)}</span>
    </span>
  );
}

/**
 * The whole path for "Ver tudo": the slug first, breaking only at hyphens and slashes, then the
 * leading part in a muted line below (cut at the end, whole in the tooltip).
 */
function WrappedPath({ text }: { text: string }) {
  const cut = text.lastIndexOf("/", text.length - 2);
  const breakable = (s: string) => s.split(/(?<=[-/_.])/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]));
  if (cut <= 0) return <span className="min-w-0 [overflow-wrap:anywhere]">{breakable(text)}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="sr-only">{text}</span>
      <span className="[overflow-wrap:anywhere]" aria-hidden="true">{breakable(text.slice(cut))}</span>
      <span className="truncate text-sm text-muted" title={text} aria-hidden="true">{text.slice(0, cut)}</span>
    </span>
  );
}

type TabKey = Dim | "channel";

function Breakdowns({ data, site, f, range }: { data: Overview; site: SiteInfo; f: Formatters; range: { from: string; to: string } }) {
  const { t } = useI18n();
  const pv = data.summary.current.pageviews;
  const totalVisits = data.channels.reduce((a, c) => a + c.visits, 0);
  const label = (r: Row, tab: TabKey, wrap = false): ReactNode => {
    const v = r.value;
    switch (tab) {
      case "country": return <><Flag code={v} />{f.country(v) ?? t("dashboard.unknown")}</>;
      case "browser": return <><BrowserIcon name={v} />{v === "Unknown" || !v ? t("dashboard.unknown") : agentName(v)}</>;
      case "os": return <><OsIcon name={v} />{v === "Unknown" || !v ? t("dashboard.unknown") : agentName(v)}</>;
      case "device": return <><DeviceIcon name={v} />{t(`devices.${v}` as MessageKey) === `devices.${v}` ? (v || t("dashboard.unknown")) : t(`devices.${v}` as MessageKey)}</>;
      case "channel": return <><ChannelIcon name={v} />{t(`channels.${v}` as MessageKey)}</>;
      case "ref": return <><Favicon host={v} />{v}</>;
      // "Ver tudo" is where the whole path is read: it wraps instead of cutting.
      default: return v ? wrap ? <WrappedPath text={v} /> : <MiddleEllipsis text={v} /> : t("dashboard.empty");
    }
  };
  const groups: { title: string; tabs: { key: TabKey; label: string; rows: Row[]; metric: "pageviews" | "visits"; total: number; empty?: string }[] }[] = [
    { title: t("dashboard.pages"), tabs: [
      { key: "path", label: t("dashboard.pages"), rows: data.top.path, metric: "pageviews", total: pv },
    ] },
    { title: t("dashboard.sources"), tabs: [
      { key: "channel", label: t("dashboard.channels"), rows: data.channels, metric: "visits", total: totalVisits },
      { key: "ref", label: t("dashboard.referrers"), rows: data.top.ref, metric: "visits", total: data.summary.current.visits, empty: t("dashboard.noReferrers") },
    ] },
    { title: t("dashboard.locations"), tabs: [
      { key: "country", label: t("dashboard.countries"), rows: data.top.country, metric: "pageviews", total: pv },
    ] },
    { title: t("dashboard.technology"), tabs: [
      { key: "browser", label: t("dashboard.browsers"), rows: data.top.browser, metric: "pageviews", total: pv },
      { key: "os", label: t("dashboard.os"), rows: data.top.os, metric: "pageviews", total: pv },
      { key: "device", label: t("dashboard.devices"), rows: data.top.device, metric: "pageviews", total: pv },
    ] },
  ];
  return (
    <div className="grid grid-cols-2 gap-5 max-wide:grid-cols-1">
      {groups.map((g) => <BreakdownPanel key={g.title} title={g.title} tabs={g.tabs} label={label} f={f} site={site.site_tag} range={range} />)}
    </div>
  );
}

function BreakdownPanel({ title, tabs, label, f, site, range }: {
  title: string; f: Formatters; site: string; range: { from: string; to: string };
  tabs: { key: TabKey; label: string; rows: Row[]; metric: "pageviews" | "visits"; total: number; empty?: string }[];
  label: (r: Row, tab: TabKey, wrap?: boolean) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  // A non-default tab lives in the URL (e.g. channelTab=ref), so reload and shared links keep it.
  const { search } = useLocation();
  const param = `${tabs[0].key}Tab`;
  const fromUrl = new URLSearchParams(search).get(param);
  const active = tabs.some((x) => x.key === fromUrl) ? (fromUrl as TabKey) : tabs[0].key;
  const setActive = (k: TabKey) => {
    const n = new URLSearchParams(location.search);
    if (k === tabs[0].key) n.delete(param); else n.set(param, k);
    const q = n.toString();
    navigate(`${location.pathname}${q ? `?${q}` : ""}`, true);
  };
  const [more, setMore] = useState(false);
  const tab = tabs.find((x) => x.key === active)!;
  const col = tab.metric === "visits" ? t("dashboard.visits") : t("dashboard.views");
  const list = (
    <RowList rows={tab.rows} metric={tab.metric} total={tab.total} render={(r) => label(r, tab.key)} f={f} empty={tab.empty}
      labelCol={tab.label} metricCol={col} />
  );
  return (
    <section className={cn(panelCls, "flex flex-col")} aria-label={title}>
      <header className="mb-3 flex min-h-9 items-center justify-between gap-3 max-xs:flex-col max-xs:items-stretch max-xs:gap-2">
        {tabs.length > 1
          ? <Tabs id={id} tabs={tabs.map((x) => ({ key: x.key, label: x.label }))} value={active} onChange={setActive} label={title} />
          : <h2 className={panelTitleCls}>{tab.label}</h2>}
        <span className="text-sm font-medium text-muted max-xs:self-end" aria-hidden="true">{col}</span>
      </header>
      {tabs.length > 1
        ? <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${active}`}>{list}</div>
        : list}
      {tab.key !== "channel" && tab.rows.length >= 10 && (
        <button className="mt-2.5 self-start rounded-md px-2 py-1.5 text-md font-medium text-accent hover:bg-accent-soft" onClick={() => setMore(true)}>{t("dashboard.viewAll")}</button>
      )}
      {more && tab.key !== "channel" && (
        <MoreDialog title={tab.label} site={site} range={range} dim={tab.key} metric={tab.metric} total={tab.total}
          render={(r) => label(r, tab.key, true)} f={f} onClose={() => setMore(false)} metricCol={col} />
      )}
    </section>
  );
}

function RowList({ rows, metric, total, render, f, empty, labelCol, metricCol, wrap = false }: {
  rows: Row[]; metric: "pageviews" | "visits"; total: number; render: (r: Row) => ReactNode; f: Formatters; empty?: string;
  labelCol: string; metricCol: string; wrap?: boolean;
}) {
  const { t } = useI18n();
  if (!rows.length) return <p className={emptyCls}>{empty ?? t("dashboard.noData")}</p>;
  const max = Math.max(...rows.map((r) => r[metric]), 1);
  return (
    <table className="w-full text-md">
      <thead className="sr-only">
        <tr><th scope="col">{labelCol}</th><th scope="col">{metricCol}</th><th scope="col">{t("dashboard.share")}</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const v = r[metric];
          // Proportion bar behind the row; 2px surface-colored gaps separate rows.
          // Wrapped rows run several lines: numbers sit on the first one, next to the slug.
          const td = cn("px-2.5 py-[7px]", wrap && "align-top", i > 0 && "border-t-2 border-surface");
          return (
            <tr key={r.value}>
              {/* The bar lives in the label cell only: a fill across the whole row read as a selected row. */}
              <td className={cn(td, "w-full max-w-0 bg-[linear-gradient(90deg,var(--bar)_var(--w),transparent_var(--w))] bg-no-repeat forced-colors:bg-none")}
                style={{ "--w": `${(v / max) * 100}%` } as React.CSSProperties}>
                <span title={wrap ? undefined : r.value} className={wrap
                  ? "flex items-start gap-2.5"
                  : "flex items-center gap-2.5 overflow-hidden text-ellipsis whitespace-nowrap"}>{render(r)}</span>
              </td>
              <td className={cn(td, numCls, "font-semibold")}>{f.full(v)}</td>
              <td className={cn(td, numCls, "w-[4.5em] text-sm text-muted")}>{f.pct(total > 0 ? (v / total) * 100 : 0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MoreDialog({ title, site, range, dim, metric, total, render, f, onClose, metricCol }: {
  title: string; site: string; range: { from: string; to: string }; dim: Dim; metric: "pageviews" | "visits"; total: number;
  render: (r: Row) => ReactNode; f: Formatters; onClose: () => void; metricCol: string;
}) {
  const { t, te } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    fetchTop(site, range.from, range.to, dim)
      .then((r) => setRows(dim === "ref" ? r.rows.filter((x) => x.value) : r.rows))
      .catch((e) => setError(te(e instanceof ApiError ? e.code : "generic")));
  }, [site, range.from, range.to, dim, te, attempt]);
  const q = query.trim().toLowerCase();
  const shown = rows && q ? rows.filter((r) => r.value.toLowerCase().includes(q)) : rows;
  return (
    <Dialog title={title} onClose={onClose} wide>
      {error ? <Notice tone="error">{error} <button className={linkCls} onClick={() => setAttempt((n) => n + 1)}>{t("app.retry")}</button></Notice> : !rows ? <Spinner /> : (
        <>
          <label>
            <span className="sr-only">{t("dashboard.filter")}</span>
            <input type="search" className={cn(inputCls, "mb-1")} placeholder={t("dashboard.filter")} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          {shown && shown.length
            ? <RowList rows={shown} metric={metric} total={total} render={render} f={f} labelCol={title} metricCol={metricCol} wrap />
            : <p className={emptyCls}>{t("dashboard.noMatches")}</p>}
        </>
      )}
    </Dialog>
  );
}

// ---------- Web Vitals ----------

const VITALS = [
  { key: "lcp", good: 2500, poor: 4000, unit: "ms", core: true },
  { key: "inp", good: 200, poor: 500, unit: "ms", core: true },
  { key: "cls", good: 0.1, poor: 0.25, unit: "", core: true },
  { key: "fcp", good: 1800, poor: 3000, unit: "ms", core: false },
  { key: "ttfb", good: 800, poor: 1800, unit: "ms", core: false },
] as const;

const SEGMENT_BG = { good: "bg-good", ni: "bg-warning", poor: "bg-poor" } as const;

const VITAL_GROUPS = [
  { id: "core", title: "vitals.coreTitle", lead: "vitals.coreLead", core: true },
  { id: "diag", title: "vitals.diagTitle", lead: "vitals.diagLead", core: false },
] as const;

export function VitalsPage({ siteTag }: { siteTag: string }) {
  const { t, locale } = useI18n();
  const site = useSite(siteTag);
  const { data, error, loading, retry } = useOverview(siteTag);
  useTitle(site?.host, t("nav.vitals"));
  const f = useMemo(() => formatters(locale), [locale]);
  if (!site) return <NoSites />;
  const fmt = (v: number, unit: string) =>
    unit === "ms" ? (v >= 1000 ? `${(v / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} s` : `${f.full(v)} ms`)
      // CLS is unitless; "0" would read as no data, so always two decimals ("0.00").
      : v.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 });

  return (
    <>
      <PageHead site={site}><PeriodPicker /></PageHead>
      <p className="mb-5 max-w-[76ch] text-ink-2">{t("vitals.lead")}</p>
      {error && <Notice tone="error">{error} <button className={linkCls} onClick={retry}>{t("app.retry")}</button></Notice>}
      {!data && loading && <Spinner />}
      {data && VITAL_GROUPS.map((g, gi) => (
        <section key={g.id} className={cn(gi > 0 && "mt-8")} aria-labelledby={`vg-${g.id}`}>
        <header className="mb-3 flex flex-col gap-0.5">
          <h2 id={`vg-${g.id}`} className="text-base font-semibold">{t(g.title)}</h2>
          <p className="max-w-[68ch] text-sm text-muted">{t(g.lead)}</p>
        </header>
        {/* Fixed three columns so both groups share one grid (auto-fill left a fourth, empty track). */}
        <div className="grid grid-cols-3 gap-4 max-wide:grid-cols-2 max-xs:grid-cols-1" aria-busy={loading}>
          {VITALS.filter((m) => m.core === g.core).map((m) => {
            const v = data.vitals;
            const p75 = v[`${m.key}_p75`];
            const prevP75 = data.previousVitals?.[`${m.key}_p75`] ?? null;
            const good = v[`${m.key}_good`] ?? 0, poor = v[`${m.key}_poor`] ?? 0, total = v[`${m.key}_total`] ?? 0;
            const ni = Math.max(total - good - poor, 0);
            const status = p75 == null ? null : p75 <= m.good ? "good" : p75 <= m.poor ? "ni" : "poor";
            const statusLabel = status === "good" ? t("vitals.good") : status === "ni" ? t("vitals.needsImprovement") : t("vitals.poor");
            const parts = [
              { cls: "good" as const, label: t("vitals.good"), n: good },
              { cls: "ni" as const, label: t("vitals.needsImprovement"), n: ni },
              { cls: "poor" as const, label: t("vitals.poor"), n: poor },
            ];
            return (
              <section className={cn(panelCls, "flex flex-col gap-3")} key={m.key} aria-labelledby={`v-${m.key}`}>
                <header>
                  <h3 id={`v-${m.key}`} className="text-lg font-[650]">{m.key.toUpperCase()}</h3>
                  <p className="text-sm text-muted">{t(`vitals.${m.key}` as MessageKey)}</p>
                </header>
                {p75 == null || !total ? (
                  <p className={emptyCls}>{t("vitals.noSamples")}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <strong className={bigNumberCls}>{fmt(p75, m.unit)}</strong>
                      <StatusBadge tone={status}>{statusLabel}</StatusBadge>
                    </div>
                    {/* The legend below reads the same percentages. */}
                    <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-surface-2" aria-hidden="true">
                      {parts.filter((x) => x.n > 0).map((x) => <span key={x.cls} className={cn("min-w-[3px]", SEGMENT_BG[x.cls])} style={{ flexGrow: x.n }} />)}
                    </div>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink-2">
                      {parts.map((x) => (
                        <li key={x.cls} className="inline-flex items-center gap-1.5">
                          <i className={cn("size-2.5 rounded-[2px]", SEGMENT_BG[x.cls])} aria-hidden="true" />{x.label} <b className="text-ink tabular-nums">{f.pct((x.n / total) * 100)}</b>
                        </li>
                      ))}
                    </ul>
                    {prevP75 != null && prevP75 > 0 && (
                      <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
                        <Delta cur={p75} prev={prevP75} f={f} invert />{t("vitals.vsPrevious", { value: fmt(prevP75, m.unit) })}
                      </p>
                    )}
                    <div className="text-sm text-muted">
                      <p>{t("vitals.samples", { count: f.full(total) })}</p>
                      <p>{t("vitals.thresholds", { good: fmt(m.good, m.unit), poor: fmt(m.poor, m.unit) })}</p>
                    </div>
                  </>
                )}
              </section>
            );
          })}
        </div>
        </section>
      ))}
      <footer className={footnoteCls}><p>{t("vitals.note")}</p></footer>
    </>
  );
}

