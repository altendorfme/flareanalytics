import type { Env } from "./env";
import { api } from "./api/routes";
import { runHourly, runMaintenance } from "./collector/jobs";

/** Private dashboard: no indexing, no AI use. */
const ROBOTS_TAG = "noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai";

/** Known AI crawlers and scrapers get 403 (robots.txt stays open). */
const BLOCKED_UA = new RegExp(
  [
    "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "Claude-User", "Claude-SearchBot", "anthropic-ai",
    "Google-Extended", "GoogleOther", "Google-CloudVertexBot", "CCBot", "PerplexityBot", "Perplexity-User", "Bytespider",
    "Amazonbot", "Applebot-Extended", "meta-externalagent", "meta-externalfetcher", "FacebookBot", "cohere-ai",
    "cohere-training-data-crawler", "Diffbot", "ImagesiftBot", "Omgili", "YouBot", "MistralAI-User", "DuckAssistBot",
    "AI2Bot", "Ai2Bot-Dolma", "PetalBot", "Timpibot", "Webzio-Extended", "img2dataset", "Scrapy", "python-requests",
    "Go-http-client", "HeadlessChrome",
  ].map((s) => s.replace(/[-.]/g, "\\$&")).join("|"),
  "i",
);

function withRobotsTag(res: Response): Response {
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", ROBOTS_TAG);
  out.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  out.headers.set("X-Frame-Options", "DENY");
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/robots.txt" && BLOCKED_UA.test(request.headers.get("user-agent") ?? "")) {
      return withRobotsTag(new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain" } }));
    }
    const res = url.pathname.startsWith("/api/") ? await api.fetch(request, env, ctx) : await env.ASSETS.fetch(request);
    return withRobotsTag(res);
  },

  async scheduled(controller, env, ctx) {
    const now = new Date(controller.scheduledTime);
    const job = controller.cron === "45 * * * *" ? runMaintenance(env, now) : runHourly(env, now);
    ctx.waitUntil(
      job
        .then((r) => console.log(JSON.stringify({ cron: controller.cron, result: r })))
        .catch((e) => console.error(`cron ${controller.cron} falhou:`, e)),
    );
  },
} satisfies ExportedHandler<Env>;
