export interface SiteInfo { site_tag: string; host: string; active: number; first_day: string | null }
export interface Totals { pageviews: number; visits: number }
export interface Row { value: string; pageviews: number; visits: number; channel?: string }
export interface Point { t: string; pageviews: number; visits: number }
export type Vitals = Record<string, number | null>;
export type Dim = "path" | "ref" | "country" | "browser" | "os" | "device" | "host";

export interface Overview {
  range: {
    site: string; from: string; to: string; days: number; prevFrom: string; prevTo: string; unit: "hour" | "day";
    partialCompare: boolean; compareUntil: string | null;
  };
  summary: { current: Totals; previous: Totals };
  series: Point[];
  previousSeries: Point[];
  previousCut?: Totals | null;
  top: Record<Dim, Row[]>;
  channels: Row[];
  vitals: Vitals;
  previousVitals?: Vitals;
}

export interface Me {
  id: string; email: string; name: string; role: "admin" | "member"; locale: string | null; mustChangePassword: boolean;
}

/** Error carrying the API's stable code, translated by the client. */
export class ApiError extends Error {
  constructor(public code: string, public status: number, public detail?: any) {
    super(code);
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError("network", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(json.error ?? "generic", res.status, json.detail);
    if (res.status === 401 || json.error === "password_change_required") {
      window.dispatchEvent(new CustomEvent("fa:auth", { detail: json.error }));
    }
    throw err;
  }
  return json as T;
}

export const get = <T,>(path: string) => request<T>("GET", path);
export const post = <T,>(path: string, body: unknown = {}) => request<T>("POST", path, body);
export const patch = <T,>(path: string, body: unknown) => request<T>("PATCH", path, body);
export const del = <T,>(path: string) => request<T>("DELETE", path);

export const fetchSites = () => get<{ sites: SiteInfo[]; timeZone: string; lastRun: string | null }>("/api/sites");
export const fetchOverview = (site: string, from: string, to: string) =>
  get<Overview>(`/api/overview?site=${site}&from=${from}&to=${to}&limit=10`);
export interface SiteSummary { site_tag: string; host: string; current: Totals; previous: Totals; series: Point[]; previousSeries: Point[]; previousCut?: Totals | null }
export interface Summary {
  range: { from: string; to: string; days: number; prevFrom: string; prevTo: string; unit: "hour" | "day"; partialCompare: boolean; compareUntil: string | null };
  sites: SiteSummary[];
}
export const fetchSummary = (from: string, to: string) => get<Summary>(`/api/summary?from=${from}&to=${to}`);
export const fetchTop = (site: string, from: string, to: string, dim: Dim) =>
  get<{ rows: Row[] }>(`/api/top?site=${site}&from=${from}&to=${to}&dim=${dim}&limit=200`);
