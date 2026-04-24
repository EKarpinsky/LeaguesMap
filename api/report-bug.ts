/**
 * POST /api/report-bug
 *
 * Vercel Edge Function that ships LeaguesMap bug reports to
 * eli@karpinsky.io via Resend's REST API.
 *
 * Why edge runtime? Cold-start is ~0ms vs ~250ms for node lambdas,
 * the handler is pure fetch (no Node-only APIs), and it stays free
 * on Vercel's hobby plan up to 1M invocations/mo — orders of
 * magnitude beyond what any bug-report endpoint needs.
 *
 * Why no SDK? Resend's REST endpoint is one POST. Adding the
 * `resend` npm package would pull ~40 KB of SDK + types into the
 * edge bundle for zero benefit; `fetch` is built in.
 *
 * Required env vars (set in Vercel dashboard → project → Settings → Environment Variables):
 *   RESEND_API_KEY     Resend API key. Get one at https://resend.com/api-keys
 *
 * Optional env vars:
 *   RESEND_FROM        Verified sender, e.g. "LeaguesMap Bugs <bugs@leaguesmap.io>".
 *                      Defaults to Resend's shared dev sender, which works
 *                      out-of-the-box but lands in spam more often. Verify
 *                      a domain in Resend → Domains to use a custom address.
 *   REPORT_BUG_TO      Recipient. Defaults to eli@karpinsky.io.
 *
 * Spam controls (defense in depth):
 *   • Honeypot field "website" — humans never fill it; bots almost always do.
 *   • Min/max message length: 5..5000 chars.
 *   • Per-IP in-memory rate limit: 5 reports / 10 minutes per edge instance.
 *     This is best-effort (edge instances are isolated) — for stronger
 *     guarantees, swap for Vercel KV / Upstash Ratelimit later.
 */

export const config = { runtime: "edge" };

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
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Don't leak details to the client — but log it so the next deploy
    // can be diagnosed from the Vercel function logs.
    console.error("[report-bug] RESEND_API_KEY not set");
    return jsonResponse(
      { error: "Email backend not configured" },
      { status: 500 },
    );
  }

  // Vercel sets x-real-ip + x-forwarded-for; fall back to a placeholder
  // so a missing header (local dev) doesn't blow up the limiter.
  const ip =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  if (rateLimited(ip)) {
    return jsonResponse(
      { error: "Too many reports — try again in a few minutes." },
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
    "— Context —",
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
      from: process.env.RESEND_FROM ?? "LeaguesMap <onboarding@resend.dev>",
      to: [process.env.REPORT_BUG_TO ?? TO],
      subject: SUBJECT,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[report-bug] Resend rejected:", res.status, errBody);
    return jsonResponse(
      { error: "Couldn't send report — please try again." },
      { status: 502 },
    );
  }

  return jsonResponse({ ok: true });
}
