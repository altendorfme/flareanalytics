// Referrer → channel classification (Umami/Rybbit style), done at query time.
export type Channel = "direct" | "search" | "ai" | "social" | "email" | "referral" | "internal";

const AI = ["chatgpt.com", "chat.openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "copilot.microsoft.com", "chat.deepseek.com", "meta.ai", "grok.com", "you.com", "phind.com"];
const SEARCH = [/(^|\.)google\.[a-z.]+$/, /(^|\.)bing\.com$/, /(^|\.)duckduckgo\.com$/, /(^|\.)search\.yahoo\.com$/, /(^|\.)yahoo\.com$/, /(^|\.)yandex\.[a-z.]+$/, /(^|\.)baidu\.com$/, /(^|\.)ecosia\.org$/, /(^|\.)search\.brave\.com$/, /(^|\.)startpage\.com$/, /(^|\.)qwant\.com$/, /(^|\.)naver\.com$/, /(^|\.)kagi\.com$/];
const SOCIAL = ["t.co", "x.com", "twitter.com", "facebook.com", "m.facebook.com", "l.facebook.com", "lm.facebook.com", "instagram.com", "l.instagram.com", "linkedin.com", "lnkd.in", "reddit.com", "old.reddit.com", "youtube.com", "m.youtube.com", "tiktok.com", "pinterest.com", "br.pinterest.com", "threads.net", "threads.com", "bsky.app", "mastodon.social", "news.ycombinator.com", "web.whatsapp.com", "wa.me", "t.me", "web.telegram.org", "discord.com", "tumblr.com", "quora.com", "medium.com"];
const EMAIL = ["mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com", "mail.proton.me", "webmail"];

const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function classify(refHost: string, internalHosts: Set<string>): Channel {
  const h = strip(refHost);
  if (!h) return "direct";
  if (internalHosts.has(h)) return "internal";
  // AI before search: gemini.google.com would match the Google pattern.
  if (AI.some((d) => h === d || h.endsWith(`.${d}`))) return "ai";
  if (SEARCH.some((re) => re.test(h)) && !h.startsWith("mail.")) return "search";
  if (SOCIAL.some((d) => h === d || h.endsWith(`.${d}`))) return "social";
  if (EMAIL.some((d) => h === d || h.startsWith(d))) return "email";
  return "referral";
}

/** Internal hosts: the site host plus every hostname seen on it. */
export function internalSet(hosts: string[]): Set<string> {
  return new Set(hosts.filter(Boolean).map(strip));
}
