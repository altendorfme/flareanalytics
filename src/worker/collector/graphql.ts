const API = "https://api.cloudflare.com/client/v4";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CfHttpError extends Error {
  constructor(public status: number, public url: string, public body: string) {
    super(`HTTP ${status} em ${url}: ${body.slice(0, 300)}`);
  }
}

/** Cloudflare API call, retried on 429/5xx. */
export async function cfFetch(token: string, url: string, init: RequestInit = {}): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new CfHttpError(res.status, url, "");
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new CfHttpError(res.status, url, await res.text());
    return res.json();
  }
  throw lastErr;
}

/** GraphQL Analytics returns 200 even on error, so always check `errors`. */
export async function gql<T>(token: string, query: string): Promise<T> {
  const json = await cfFetch(token, `${API}/graphql`, { method: "POST", body: JSON.stringify({ query }) });
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e: any) => e.message).join("; ")}`);
  return json.data as T;
}

/** Paginated REST GET ({ result, result_info } envelope). */
export async function restList<T>(token: string, path: string, perPage = 50): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await cfFetch(token, `${API}${path}${sep}per_page=${perPage}&page=${page}`);
    if (!json.success) throw new Error(`REST ${path}: ${JSON.stringify(json.errors)}`);
    const result: T[] = json.result ?? [];
    out.push(...result);
    const totalPages = json.result_info?.total_pages ?? 1;
    if (page >= totalPages || result.length < perPage) break;
  }
  return out;
}
