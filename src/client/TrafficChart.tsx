import { useEffect, useRef } from "react";
import { init, use, graphic, type ECharts } from "echarts/core";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkAreaComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { delta, tickLabel } from "./format";
import type { PartialBucket } from "./Dashboard";
import { THEME_EVENT } from "./theme";
import { chartBoxCls } from "./ui";

use([LineChart, GridComponent, TooltipComponent, AriaComponent, MarkAreaComponent, CanvasRenderer]);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** #rrggbb → rgba(r,g,b,a). */
function alpha(hex: string, a: number) {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

export interface ChartPoint { t: string; value: number }

/**
 * Late collection: bucket `index` holds only what was collected up to the last run; later buckets
 * have no data (not zeros).
 */
export interface StaleSpan { index: number; label: string; partialLabel: string; legend: string; note: string; partialNote: string }

/** Diagonal hatch for the uncollected span, never a data color. */
function hatch(color: string) {
  const c = document.createElement("canvas");
  const s = 8 * Math.max(1, Math.round(devicePixelRatio || 1));
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.strokeStyle = color;
  g.lineWidth = s / 8;
  g.beginPath();
  for (const o of [-s, 0, s]) { g.moveTo(o, s); g.lineTo(o + s, 0); }
  g.stroke();
  return c;
}

/** Many zero hours: a smooth curve would invent traffic between them. */
const sparse = (v: (number | null)[]) => {
  const n = v.filter((x) => x != null);
  return n.length > 0 && n.filter((x) => x === 0).length / n.length > 0.25;
};

/**
 * Current metric as a smooth area, previous period dashed behind it. The in-progress bucket ends in
 * dashed orange to a hollow projection point, with a smaller solid dot at the partial value, so it
 * never reads as a drop.
 */
export function TrafficChart({
  points, previous, unit, timeZone, locale, label, format, partial, partialNote, currentLabel, previousLabel, projectedLabel, stale, integer = true,
}: {
  points: ChartPoint[]; previous: (number | null)[]; unit: "hour" | "day"; timeZone: string; locale: string; label: string;
  format: (n: number) => string; partial: PartialBucket | null; partialNote: (b: PartialBucket) => string;
  currentLabel: string; previousLabel: string; projectedLabel: string; stale: StaleSpan | null;
  /** Counts: no 0.5 axis steps (rounded, they became "0, 1, 1, 2"). */
  integer?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  // Tooltip text is read on hover, so changing only the formatter needs no redraw.
  const note = useRef(partialNote);
  note.current = partialNote;

  // Single instance; resizes with the container.
  useEffect(() => {
    const c = init(box.current!, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(box.current!);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const render = () => {
      const c = chart.current;
      if (!c) return;
      const series1 = css("--series-1"), fresh = css("--fresh"), muted = css("--text-muted"), grid = css("--grid"),
        axis = css("--axis"), surface = css("--surface"), ink = css("--text"), font = css("--font"), shadow = css("--shadow-pop");
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const labels = points.map((p) => tickLabel(p.t, unit, timeZone, locale));
      const partialIndex = partial?.index ?? null;
      const hasPartial = partialIndex != null && partialIndex === points.length - 1;
      const projected = hasPartial ? partial!.projected : null;
      // The in-progress bucket draws the projection when there is one; the partial becomes a smaller dot.
      const staleIndex = stale?.index ?? null;
      // Null after the incomplete bucket so the line stops instead of dropping to zero.
      const values: (number | null)[] = points.map((p, i) => (staleIndex != null && i > staleIndex ? null
        : hasPartial && i === partialIndex && projected != null ? projected : p.value));
      // The closed line stops at the last complete point; a dashed bridge runs to the in-progress bucket.
      const closed = values.map((v, i) => ((hasPartial && i === partialIndex) || (staleIndex != null && i >= staleIndex) ? null : v));
      const staleDot = points.map((p, i) => (i === staleIndex ? p.value : null));
      const smoothCur = unit === "hour" && !sparse(closed) ? 0.3 : false;
      const smoothPrev = unit === "hour" && !sparse(previous) ? 0.3 : false;
      const last = points.length - 1;
      // Hatch only where nothing was fetched: after the incomplete bucket. If it is last, there is no empty span.
      const areaStart = staleIndex == null || staleIndex >= last ? null : staleIndex;
      // The incomplete bucket joins the last full one with a dotted segment (as in the Overview sparkline)
      // instead of floating as a lone dot that reads as a fault.
      const staleBridge = points.map((_, i) => (staleIndex != null && staleIndex > 0 && (i === staleIndex || i === staleIndex - 1) ? values[i] : null));
      const areaWide = areaStart != null && c.getWidth() * ((last - areaStart) / Math.max(last, 1)) >= 150;
      const bridge = values.map((v, i) => (hasPartial && (i === partialIndex || i === partialIndex! - 1) ? v : null));
      const actualDot = points.map((p, i) => (hasPartial && i === partialIndex && projected != null ? p.value : null));

      const when = (i: number) => {
        const p = points[i];
        if (unit === "day") {
          return new Date(`${p.t}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
        }
        // An hour is a range: "Wed, Nov 4, 14:00–15:00".
        const d = new Date(p.t);
        const end = new Date(d.getTime() + 3_600_000);
        const time = (x: Date) => x.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone });
        return `${d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone })}, ${time(d)}–${time(end)}`;
      };

      c.setOption({
        animation: !reduce,
        animationDuration: 600,
        animationEasing: "cubicOut",
        animationDurationUpdate: 300,
        aria: { enabled: true, label: { description: label } },
        textStyle: { fontFamily: font, fontSize: 14, color: muted },
        grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
        tooltip: {
          trigger: "axis",
          backgroundColor: surface,
          borderColor: grid,
          borderWidth: 1,
          padding: [10, 12],
          textStyle: { fontFamily: font, fontSize: 14, color: ink },
          extraCssText: `box-shadow: ${shadow}; border-radius: 8px;`,
          axisPointer: { type: "line", lineStyle: { color: axis, width: 1 } },
          formatter: (params: unknown) => {
            const i = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
            const cur = values[i];
            const prev = previous[i];
            const row = (color: string, dashed: boolean, name: string, v: string, extra = "") =>
              `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                <i style="width:14px;height:0;border-top:2px ${dashed ? "dashed" : "solid"} ${color}"></i>
                <span style="flex:1">${name}</span><b style="font-variant-numeric:tabular-nums">${v}</b>${extra}</div>`;
            const noteBox = (text: string) =>
              `<div style="color:${ink};margin-top:8px;max-width:260px;white-space:normal;line-height:1.45">${text}</div>`;
            if (cur == null) {
              return `<div style="font-weight:600;margin-bottom:2px">${when(i)}</div>`
                + row(muted, false, stale?.label ?? currentLabel, "—")
                + (prev == null ? "" : row(muted, true, previousLabel, format(prev)))
                + (stale ? noteBox(stale.note) : "");
            }
            const d = prev == null ? null : delta(cur, prev);
            // Comparing a late, partial bucket with a full previous one would look like a drop.
            const pct = d == null || i === staleIndex ? "" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
            return `<div style="font-weight:600;margin-bottom:2px">${when(i)}</div>`
              + row(hasPartial && i === partialIndex ? fresh : series1, hasPartial && i === partialIndex,
                hasPartial && i === partialIndex && projected != null ? projectedLabel : currentLabel, format(cur),
                pct ? `<span style="color:${muted};margin-left:6px">${pct}</span>` : "")
              + (prev == null ? "" : row(muted, true, previousLabel, format(prev)))
              + (hasPartial && i === partialIndex
                ? `<div style="color:${ink};margin-top:8px;max-width:260px;white-space:normal;line-height:1.45">
                    <i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${fresh};margin-right:6px;vertical-align:1px"></i>${note.current(partial!)}</div>`
                : i === staleIndex && stale ? noteBox(stale.partialNote) : "");
          },
        },
        xAxis: {
          type: "category",
          boundaryGap: false,
          data: labels,
          axisLine: { lineStyle: { color: axis } },
          axisTick: { show: false },
          axisLabel: { color: muted, fontSize: 14, fontFamily: font, hideOverlap: true, margin: 12 },
          splitLine: { show: false },
        },
        yAxis: {
          type: "value",
          min: 0,
          splitNumber: 4,
          ...(integer ? { minInterval: 1 } : {}),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: muted, fontSize: 14, fontFamily: font, formatter: (v: number) => format(v) },
          splitLine: { lineStyle: { color: grid } },
        },
        series: [
          {
            name: previousLabel,
            type: "line",
            data: previous,
            smooth: smoothPrev,
            smoothMonotone: "x",
            showSymbol: false,
            symbol: "none",
            z: 1,
            lineStyle: { color: muted, width: 1.5, type: [5, 4] },
            emphasis: { disabled: true },
          },
          {
            name: currentLabel,
            type: "line",
            data: closed,
            smooth: smoothCur,
            smoothMonotone: "x",
            showSymbol: false,
            symbol: "circle",
            symbolSize: 8,
            z: 3,
            connectNulls: false,
            lineStyle: { color: series1, width: 2 },
            itemStyle: { color: series1, borderColor: surface, borderWidth: 2 },
            areaStyle: {
              color: new graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: alpha(series1, 0.28) },
                { offset: 1, color: alpha(series1, 0) },
              ]),
            },
            emphasis: { focus: "none", scale: false },
            ...(areaStart != null && stale ? {
              markArea: {
                silent: true,
                itemStyle: { color: { image: hatch(axis), repeat: "repeat" } },
                label: {
                  // Only when the span has room for the text, and at the bottom, away from the lines' peaks.
                  // On a narrow span the "Não coletado" legend says the same.
                  show: areaWide, position: "insideBottomLeft", color: muted, fontSize: 14, fontFamily: font, distance: 8,
                  backgroundColor: surface, padding: [2, 6], borderRadius: 4,
                },
                data: [[{ xAxis: areaStart, name: stale.label }, { xAxis: last }]],
              },
            } : {}),
          },
          ...(staleIndex != null && staleIndex > 0 ? [{
            name: "partialBridge",
            type: "line" as const,
            data: staleBridge,
            z: 4,
            showSymbol: false,
            symbol: "none",
            lineStyle: { color: series1, width: 2, type: [1, 5], cap: "round" as const },
            emphasis: { disabled: true },
            tooltip: { show: false },
          }] : []),
          ...(staleIndex != null ? [{
            name: "collected",
            type: "line" as const,
            data: staleDot,
            z: 5,
            showSymbol: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 0 },
            itemStyle: { color: series1, borderColor: surface, borderWidth: 2 },
            emphasis: { disabled: true },
            tooltip: { show: false },
          }] : []),
          ...(hasPartial ? [{
            name: projectedLabel,
            type: "line" as const,
            data: bridge,
            smooth: false,
            z: 4,
            showSymbol: true,
            symbol: "circle",
            symbolSize: (_: unknown, p: { dataIndex: number }) => (p.dataIndex === partialIndex ? 9 : 0),
            lineStyle: { color: fresh, width: 2, type: [4, 3] },
            itemStyle: { color: surface, borderColor: fresh, borderWidth: 2 },
            emphasis: { disabled: true },
            tooltip: { show: false },
          }] : []),
          ...(projected != null ? [{
            name: "partial",
            type: "line" as const,
            data: actualDot,
            z: 5,
            showSymbol: true,
            symbol: "circle",
            symbolSize: 7,
            lineStyle: { width: 0 },
            itemStyle: { color: fresh, borderColor: surface, borderWidth: 2 },
            emphasis: { disabled: true },
            tooltip: { show: false },
          }] : []),
        ],
      }, { notMerge: true });
    };
    render();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", render);
    window.addEventListener(THEME_EVENT, render);
    return () => { mq.removeEventListener("change", render); window.removeEventListener(THEME_EVENT, render); };
  }, [points, previous, unit, timeZone, locale, label, format, partial, currentLabel, previousLabel, projectedLabel, stale, integer]);

  return (
    <>
      <ul className="flex flex-wrap gap-x-[18px] gap-y-1.5 px-5 pt-2.5 text-sm text-ink-2 max-xs:px-3" aria-hidden="true">
        <li className="inline-flex items-center gap-2"><i className="h-0 w-[18px] border-t-2 border-series-1" />{currentLabel}</li>
        <li className="inline-flex items-center gap-2"><i className="h-0 w-[18px] border-t-2 border-dashed border-muted" />{previousLabel}</li>
      </ul>
      <div className={chartBoxCls}><div className="size-full" ref={box} role="img" aria-label={label} /></div>
    </>
  );
}
