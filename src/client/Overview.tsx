import { useEffect, useId, useMemo, useState } from "react";
import { ApiError, fetchSummary, type Point, type Summary } from "./api";
import { useI18n } from "./i18n";
import { delta, fillSeries, formatters, partialBucket, project, type Formatters, STALE_MS } from "./format";
import { navigate, onLinkClick, useLocation } from "./router";
import { useSites } from "./Shell";
import { bigNumberCls, CompareLine, compareLabel, Delta, Freshness, metricLabelCls, NoSites, PeriodPicker, useLate, usePeriod } from "./Dashboard";
import { Favicon } from "./icons";
import { cn, labelCls, linkCls, Notice, pageHeadCls, pageTitleCls, panelCls, panelTitleCls, selectCls, Spinner } from "./ui";
import { useTitle } from "./useTitle";

function useSummary() {
  const { te } = useI18n();
  const { range } = usePeriod();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    fetchSummary(range.from, range.to)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(te(e instanceof ApiError ? e.code : "generic")))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [range.from, range.to, tick, te]);
  return { data, error, loading, retry: () => setTick((n) => n + 1) };
}

/** `incomplete`: collection is late; the last bucket is partial and must not look like a drop. */
interface Spark { values: number[]; previous: (number | null)[]; projected: number | null; incomplete: boolean }

/**
 * Visits sparkline (plain SVG, no chart instance). Same grammar as the main chart: blue area,
 * previous period dashed on the same scale, in-progress bucket dashed orange to the projection.
 */
function Sparkline({ values, previous, projected, incomplete }: Spark) {
  const id = useId();
  if (values.length < 2) return <div className="mx-[-18px] mt-auto mb-0 block h-12 w-[calc(100%+36px)]" aria-hidden="true" />;
  const last = values.length - 1;
  const shown = projected != null ? [...values.slice(0, last), projected] : values;
  const W = 240, H = 48;
  const max = Math.max(...shown, ...previous.map((v) => v ?? 0), 1);
  const x = (i: number) => (i / last) * W;
  const y = (v: number) => H - 2 - (v / max) * (H - 8);
  const path = (vs: (number | null)[]) =>
    vs.map((v, i) => (v == null ? "" : `${i && vs[i - 1] != null ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join(" ");
  const solid = projected != null || incomplete ? shown.slice(0, last) : shown;
  const line = path(solid);
  const endX = x(solid.length - 1);
  return (
    <svg className="mx-[-18px] mt-auto mb-0 block h-12 w-[calc(100%+36px)]" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--series-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path(previous)} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L${endX},${H} L0,${H} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {projected != null && (
        <path d={`M${endX},${y(solid[solid.length - 1])} L${W},${y(projected)}`} fill="none" stroke="var(--fresh)" strokeWidth="2"
          strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      {incomplete && projected == null && (
        <path d={`M${endX},${y(solid[solid.length - 1])} L${W},${y(values[last])}`} fill="none" stroke="var(--series-1)" strokeWidth="2.5"
          strokeDasharray="0.1 3.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function Stat({ label, value, prev, f, late }: { label: string; value: number; prev: number; f: Formatters; late: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 not-first:border-l not-first:border-border not-first:pl-12 max-xs:not-first:pl-4">
      <span className={metricLabelCls}>{label}</span>
      <span className={cn(bigNumberCls, "leading-[1.2] max-xs:text-[24px]")}>{f.num(value)}</span>
      <Delta cur={value} prev={prev} f={f} counts late={late} />
    </div>
  );
}

const SORTS = ["visits", "change"] as const;
type Sort = (typeof SORTS)[number];

export function OverviewPage() {
  const { t, locale } = useI18n();
  const { sites, timeZone, lastRun } = useSites();
  const { path, search } = useLocation();
  const sortParam = new URLSearchParams(search).get("sort");
  const sort: Sort = SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : "visits";
  const setSort = (v: Sort) => {
    const qs = new URLSearchParams(search);
    if (v === "visits") qs.delete("sort"); else qs.set("sort", v);
    const q = qs.toString();
    navigate(`${path}${q ? `?${q}` : ""}`, true);
  };
  const { data, error, loading, retry } = useSummary();
  useTitle(t("overview.title"));
  const f = useMemo(() => formatters(locale), [locale]);

  const { today } = usePeriod();
  const rows = useMemo(() => {
    if (!data) return [];
    const { unit, from, to, prevFrom, prevTo } = data.range;
    const until = lastRun ? Date.parse(lastRun) : Date.now();
    const late = lastRun != null && to === today && Date.now() - until > STALE_MS;
    return data.sites
      .map((s) => {
        const filled = fillSeries(s.series as Point[], unit, from, to, timeZone, until);
        const bucket = partialBucket(filled, unit, from, to, today, s.current, lastRun, timeZone);
        const prev = fillSeries(s.previousSeries as Point[], unit, prevFrom, prevTo, timeZone);
        // Atrasado no diário: o último dia do anterior também para na última coleta, como o atual.
        const li = filled.length - 1;
        if (late && unit === "day" && s.previousCut && prev[li]?.t === prevTo) prev[li] = { ...prev[li], ...s.previousCut };
        const spark: Spark = {
          values: filled.map((p) => p.visits),
          previous: filled.map((_, i) => prev[i]?.visits ?? null),
          projected: bucket ? project(filled[bucket.index].visits, bucket.fraction) : null,
          incomplete: late,
        };
        return { ...s, spark };
      })
      .sort((a, b) => {
        if (sort === "change") {
          // No comparison base (new site) sorts last.
          const da = delta(a.current.visits, a.previous.visits), db = delta(b.current.visits, b.previous.visits);
          if (da != null || db != null) return (db ?? -Infinity) - (da ?? -Infinity);
        }
        return b.current.visits - a.current.visits || b.current.pageviews - a.current.pageviews || a.host.localeCompare(b.host);
      });
  }, [data, timeZone, lastRun, today, sort]);
  const active = rows.filter((s) => s.current.visits > 0 || s.current.pageviews > 0);
  const quiet = rows.filter((s) => s.current.visits === 0 && s.current.pageviews === 0);

  const keepQs = new URLSearchParams(search);
  const keep = ["period", "from", "to"].filter((k) => keepQs.has(k)).map((k) => `${k}=${keepQs.get(k)}`).join("&");
  // Users with a single site skip the overview.
  const single = sites.length === 1 ? sites[0].site_tag : null;
  useEffect(() => {
    if (single) navigate(`/site/${single}${keep ? `?${keep}` : ""}`, true);
  }, [single, keep]);

  const lateRange = useLate(data?.range.to);
  if (!sites.length) return <NoSites />;
  if (single) return null;

  const total = rows.reduce(
    (a, s) => ({
      cur: { pageviews: a.cur.pageviews + s.current.pageviews, visits: a.cur.visits + s.current.visits },
      prev: { pageviews: a.prev.pageviews + s.previous.pageviews, visits: a.prev.visits + s.previous.visits },
    }),
    { cur: { pageviews: 0, visits: 0 }, prev: { pageviews: 0, visits: 0 } },
  );
  const compare = data ? compareLabel(data.range, t, f, timeZone, lateRange) : "";

  return (
    <>
      <header className={pageHeadCls}>
        <div>
          <h1 className={pageTitleCls}>{t("overview.title")}</h1>
          <Freshness />
        </div>
        <PeriodPicker />
      </header>
      <p className="sr-only" role="status" aria-live="polite">{data && !loading
        ? t("dashboard.totalsAnnounce", { range: f.range(data.range.from, data.range.to), visits: f.full(total.cur.visits), pageviews: f.full(total.cur.pageviews) })
        : ""}</p>
      {error && <Notice tone="error">{error} <button className={linkCls} onClick={retry}>{t("app.retry")}</button></Notice>}
      {!data && loading && <Spinner />}

      {data && (
        <div aria-busy={loading} className={cn("transition-opacity duration-200", loading && data && "opacity-60")}>
          <section className={cn(panelCls, "mb-5 flex flex-col gap-4")} aria-labelledby="totals-title">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="totals-title" className={panelTitleCls}>{t("overview.allSites")}</h2>
              <div className="flex flex-col items-end gap-1 max-xs:items-start"><CompareLine text={compare} late={lateRange} /></div>
            </div>
            <div className="grid grid-cols-[repeat(2,minmax(0,max-content))] gap-x-12 gap-y-4 max-xs:grid-cols-2 max-xs:gap-4">
              <Stat label={t("dashboard.visits")} value={total.cur.visits} prev={total.prev.visits} f={f} late={lateRange} />
              <Stat label={t("dashboard.pageviews")} value={total.cur.pageviews} prev={total.prev.pageviews} f={f} late={lateRange} />
            </div>
          </section>

          {rows.length > 2 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h2 className={panelTitleCls}>{t("overview.sitesCount", { n: rows.length })}</h2>
              <label className="flex items-center gap-2">
                <span className={cn(labelCls, "font-normal whitespace-nowrap text-ink-2")}>{t("overview.sortBy")}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={cn(selectCls, "w-auto")}>
                  {SORTS.map((k) => <option key={k} value={k}>{t(`overview.sort_${k}`)}</option>)}
                </select>
              </label>
            </div>
          )}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {active.map((s) => (
              <li key={s.site_tag}>
                <a className={cn(
                  "flex h-full flex-col gap-3.5 overflow-hidden rounded-lg border border-border bg-surface px-[18px] pt-[18px] text-ink no-underline",
                  "transition-colors duration-120 hover:border-muted hover:text-ink",
                )} href={`/site/${s.site_tag}${keep ? `?${keep}` : ""}`} onClick={onLinkClick}
                  aria-label={t("overview.openSite", { host: s.host })} aria-describedby={`stats-${s.site_tag}`}>
                  <span className="flex min-w-0 items-center gap-2.5 text-base font-semibold"><Favicon host={s.host} /><span className="truncate">{s.host}</span></span>
                  <span className="grid grid-cols-2 gap-3" id={`stats-${s.site_tag}`}>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={metricLabelCls}>{t("dashboard.visits")}</span>
                      <span className="text-[24px] leading-[1.2] font-[650] tracking-[-0.01em] tabular-nums">{f.num(s.current.visits)}</span>
                      <Delta cur={s.current.visits} prev={s.previous.visits} f={f} counts late={lateRange} />
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={metricLabelCls}>{t("dashboard.pageviews")}</span>
                      <span className="text-[24px] leading-[1.2] font-[650] tracking-[-0.01em] tabular-nums">{f.num(s.current.pageviews)}</span>
                      <Delta cur={s.current.pageviews} prev={s.previous.pageviews} f={f} counts late={lateRange} />
                    </span>
                  </span>
                  <Sparkline {...s.spark} />
                </a>
              </li>
            ))}
          </ul>

          {/* Sites without traffic: one row of links instead of empty cards. */}
          {quiet.length > 0 && (
            <section className="mt-5 flex flex-col gap-2" aria-labelledby="quiet-title">
              <h2 id="quiet-title" className="text-sm font-semibold text-muted">{t("overview.noTraffic")} · {quiet.length}</h2>
              <ul className="flex flex-wrap gap-2">
                {quiet.map((s) => (
                  <li key={s.site_tag}>
                    <a href={`/site/${s.site_tag}${keep ? `?${keep}` : ""}`} onClick={onLinkClick}
                      className="flex min-h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-md text-ink no-underline hover:border-muted hover:text-ink">
                      <Favicon host={s.host} /><span className="max-w-[24ch] truncate">{s.host}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
