import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest, type Env } from "../functions/api/report-bug";

let nextIp = 0;
function post(body: string, env: Env = {}, ip = `192.0.2.${++nextIp}`) {
  return onRequest({
    request: new Request("https://example.test/api/report-bug", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body,
    }),
    env,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Pages bug-report handler", () => {
  it("returns JSON 503 without the email binding and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post('{"message":"A map pin is misplaced"}');
    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({ error: "Email backend not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests", async () => {
    const response = await onRequest({
      request: new Request("https://example.test/api/report-bug"), env: {},
    });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });

  it.each(["{", '{"message":"x"}', JSON.stringify({ message: "x".repeat(5001) })])(
    "rejects malformed JSON or invalid message lengths",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn());
      expect((await post(body, { RESEND_API_KEY: "test-only" })).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("silently accepts honeypot submissions without sending mail", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await post('{"website":"spam.test"}', { RESEND_API_KEY: "test-only" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses Pages bindings and the Cloudflare client IP when sending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(JSON.stringify({ message: "  <b>Missing pin</b>  ", context: "<map>" }), {
      RESEND_API_KEY: "test-only",
      RESEND_FROM: "Test <sender@example.test>",
      REPORT_BUG_TO: "recipient@example.test",
    }, "192.0.2.100");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer test-only");
    const email = JSON.parse(init.body);
    expect(email.from).toBe("Test <sender@example.test>");
    expect(email.to).toEqual(["recipient@example.test"]);
    expect(email.html).toContain("&lt;b&gt;Missing pin&lt;/b&gt;");
    expect(email.html).toContain("&lt;map&gt;");
    expect(email.text).toContain("Reporter IP: 192.0.2.100");
  });

  it("preserves the 502 JSON error when Resend rejects a report", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}', { status: 403 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post('{"message":"Missing pin"}', { RESEND_API_KEY: "test-only" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't send report. Please try again." });
  });

  it("limits the sixth report from the same Cloudflare IP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}')));
    for (let count = 0; count < 5; count++) {
      expect((await post('{"message":"Missing pin"}', { RESEND_API_KEY: "test-only" }, "192.0.2.200")).status).toBe(200);
    }
    expect((await post('{"message":"Missing pin"}', { RESEND_API_KEY: "test-only" }, "192.0.2.200")).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
