import { gql } from "./graphql";
import { iso } from "../time";

export interface Site { site_tag: string; account_id: string; host: string }
export interface Row { value: string; pageviews: number; visits: number }
export interface Vitals {
  lcp_p75: number | null; inp_p75: number | null; cls_p75: number | null; fcp_p75: number | null; ttfb_p75: number | null;
  lcp_good: number; lcp_poor: number; lcp_total: number;
  inp_good: number; inp_poor: number; inp_total: number;
  cls_good: number; cls_poor: number; cls_total: number;
  fcp_good: number; fcp_poor: number; fcp_total: number;
  ttfb_good: number; ttfb_poor: number; ttfb_total: number;
}

/** Stored dimensions: short key → [GraphQL field, daily top-N]. */
export const DIMS = {
  path: ["requestPath", 50],
  ref: ["refererHost", 50],
  country: ["countryName", 50],
  browser: ["userAgentBrowser", 20],
  os: ["userAgentOS", 20],
  device: ["deviceType", 10],
  host: ["requestHost", 10],
} as const;
export type DimKey = keyof typeof DIMS;
export const DIM_KEYS = Object.keys(DIMS) as DimKey[];

export interface SiteResult {
  site_tag: string;
  totals: { pageviews: number; visits: number };
  hours: { hour: string; pageviews: number; visits: number }[];
  dims: Record<DimKey, Row[]> | null;
  vitals: Vitals | null;
}

export interface Window {
  /** Period for daily totals, tops and vitals. */
  dayStart: Date;
  dayEnd: Date;
  /** Optional period for the hourly series. */
  hoursStart?: Date;
  hoursEnd?: Date;
  withDims: boolean;
}

export const TAG_RE = /^[a-f0-9]{32}$/;

const filter = (tag: string, a: Date, b: Date) =>
  `filter:{AND:[{datetime_geq:"${iso(a)}"},{datetime_lt:"${iso(b)}"},{siteTag:"${tag}"},{bot:0}]}`;

const VITALS_FIELDS = `quantiles{ largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 firstContentfulPaintP75 timeToFirstByteP75 }
  sum{ lcpGood lcpPoor lcpTotal inpGood inpPoor inpTotal clsGood clsPoor clsTotal fcpGood fcpPoor fcpTotal ttfbGood ttfbPoor ttfbTotal }`;

/** One aliased GraphQL query for a group of same-account sites. */
export async function fetchSites(token: string, accountId: string, sites: Site[], w: Window): Promise<SiteResult[]> {
  if (!TAG_RE.test(accountId)) throw new Error(`account_id inválido: ${accountId}`);
  const parts: string[] = [];
  sites.forEach((s, i) => {
    if (!TAG_RE.test(s.site_tag)) throw new Error(`site_tag inválido: ${s.site_tag}`);
    const f = filter(s.site_tag, w.dayStart, w.dayEnd);
    parts.push(`s${i}_t: rumPageloadEventsAdaptiveGroups(${f}, limit:1){ count sum{visits} }`);
    if (w.hoursStart && w.hoursEnd) {
      const fh = filter(s.site_tag, w.hoursStart, w.hoursEnd);
      parts.push(`s${i}_h: rumPageloadEventsAdaptiveGroups(${fh}, limit:100, orderBy:[datetimeHour_ASC]){ count sum{visits} dimensions{ k: datetimeHour } }`);
    }
    if (w.withDims) {
      for (const key of DIM_KEYS) {
        const [field, limit] = DIMS[key];
        parts.push(`s${i}_${key}: rumPageloadEventsAdaptiveGroups(${f}, limit:${limit}, orderBy:[count_DESC]){ count sum{visits} dimensions{ k: ${field} } }`);
      }
      parts.push(`s${i}_wv: rumWebVitalsEventsAdaptiveGroups(${f}, limit:1){ ${VITALS_FIELDS} }`);
    }
  });

  const query = `{ viewer { accounts(filter:{accountTag:"${accountId}"}) { ${parts.join("\n")} } } }`;
  const data = await gql<any>(token, query);
  const acc = data?.viewer?.accounts?.[0] ?? {};

  return sites.map((s, i) => {
    const t = acc[`s${i}_t`]?.[0];
    const res: SiteResult = {
      site_tag: s.site_tag,
      totals: { pageviews: t?.count ?? 0, visits: t?.sum?.visits ?? 0 },
      hours: (acc[`s${i}_h`] ?? []).map((r: any) => ({
        hour: String(r.dimensions.k).replace(".000Z", "Z"),
        pageviews: r.count,
        visits: r.sum.visits,
      })),
      dims: null,
      vitals: null,
    };
    if (w.withDims) {
      const dims = {} as Record<DimKey, Row[]>;
      for (const key of DIM_KEYS) {
        dims[key] = (acc[`s${i}_${key}`] ?? []).map((r: any) => ({
          value: String(r.dimensions.k ?? ""),
          pageviews: r.count,
          visits: r.sum.visits,
        }));
      }
      res.dims = dims;
      res.vitals = toVitals(acc[`s${i}_wv`]?.[0]);
    }
    return res;
  });
}

// Time quantiles are in microseconds; -1 means no samples.
const us = (v: number | undefined) => (v == null || v < 0 ? null : Math.round(v / 1000));
const raw = (v: number | undefined) => (v == null || v < 0 ? null : v);

function toVitals(r: any): Vitals | null {
  if (!r) return null;
  const q = r.quantiles ?? {};
  const s = r.sum ?? {};
  return {
    lcp_p75: us(q.largestContentfulPaintP75),
    inp_p75: us(q.interactionToNextPaintP75),
    cls_p75: raw(q.cumulativeLayoutShiftP75),
    fcp_p75: us(q.firstContentfulPaintP75),
    ttfb_p75: us(q.timeToFirstByteP75),
    lcp_good: s.lcpGood ?? 0, lcp_poor: s.lcpPoor ?? 0, lcp_total: s.lcpTotal ?? 0,
    inp_good: s.inpGood ?? 0, inp_poor: s.inpPoor ?? 0, inp_total: s.inpTotal ?? 0,
    cls_good: s.clsGood ?? 0, cls_poor: s.clsPoor ?? 0, cls_total: s.clsTotal ?? 0,
    fcp_good: s.fcpGood ?? 0, fcp_poor: s.fcpPoor ?? 0, fcp_total: s.fcpTotal ?? 0,
    ttfb_good: s.ttfbGood ?? 0, ttfb_poor: s.ttfbPoor ?? 0, ttfb_total: s.ttfbTotal ?? 0,
  };
}
