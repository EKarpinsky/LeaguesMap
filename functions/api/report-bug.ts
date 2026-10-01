/**
 * POST /api/report-bug sends a bug report through Resend.
 * Pages env: RESEND_API_KEY (required), RESEND_FROM and REPORT_BUG_TO (optional).
 * Honeypot, message limits and per-instance rate limiting are retained.
 */
export interface Env {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  REPORT_BUG_TO?: string;
}

const TO = "eli@karpinsky.io";
const SUBJECT = "LeaguesMap bug report";
const MIN_LEN = 5;
const MAX_LEN = 5000;
const MAX_CONTEXT_LEN = 2000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

// Per-edge-instance rate limiter. Map<ip, timestampsArray>. Trimmed lazily
// on each lookup to avoid a sweeper. Adequate for low-volume sites; for
// high traffic move to KV.
const recentByIp = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    recentByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  recentByIp.set(ip, recent);
  return false;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "interest-cohort=(), browsing-topics=(), camera=(), microphone=(), geolocation=(), payment=()",
      "X-Frame-Options": "SAMEORIGIN",
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export async function onRequest({ request: req, env }: {
  request: Request;
  env: Env;
}): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[report-bug] RESEND_API_KEY not set");
    return jsonResponse(
      { error: "Email backend not configured" },
      { status: 503 },
    );
  }

  // Cloudflare supplies this header; local development uses a placeholder.
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (rateLimited(ip)) {
    return jsonResponse(
      { error: "Too many reports. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let payload: {
    message?: unknown;
    context?: unknown;
    website?: unknown;
  };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
  }

  // Honeypot: silently 200 so the bot thinks it succeeded and moves on.
  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return jsonResponse({ ok: true });
  }

  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message.length < MIN_LEN) {
    return jsonResponse(
      { error: `Message must be at least ${MIN_LEN} characters.` },
      { status: 400 },
    );
  }
  if (message.length > MAX_LEN) {
    return jsonResponse(
      { error: `Message must be at most ${MAX_LEN} characters.` },
      { status: 400 },
    );
  }

  const context =
    typeof payload.context === "string"
      ? payload.context.slice(0, MAX_CONTEXT_LEN)
      : "";

  // Build both an HTML body (for clients that render it nicely) and a
  // plain-text fallback. Resend uses the HTML when both are provided.
  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1f;max-width:640px">
  <p style="margin:0 0 12px;font-weight:600">LeaguesMap bug report</p>
  <div style="white-space:pre-wrap;background:#f5f5f8;border-left:3px solid #c4724a;padding:12px 14px;border-radius:4px;margin:0 0 16px">${escapeHtml(message)}</div>
  <p style="margin:16px 0 6px;font-size:12px;color:#6b6b7a;text-transform:uppercase;letter-spacing:.05em">Context</p>
  <pre style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#4a4a55;background:#fafafc;border:1px solid #e5e5ea;border-radius:4px;padding:10px;white-space:pre-wrap;word-break:break-all">${escapeHtml(context)}</pre>
  <p style="margin:14px 0 0;font-size:11px;color:#9a9aaa">Reporter IP: ${escapeHtml(ip)}</p>
</div>`.trim();

  const text = [
    "LeaguesMap bug report",
    "",
    message,
    "",
    "--- Context ---",
    context,
    "",
    `Reporter IP: ${ip}`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM ?? "LeaguesMap <onboarding@resend.dev>",
      to: [env.REPORT_BUG_TO ?? TO],
      subject: SUBJECT,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[report-bug] Resend rejected:", res.status, errBody);
    return jsonResponse(
      { error: "Couldn't send report. Please try again." },
      { status: 502 },
    );
  }

  return jsonResponse({ ok: true });
}
