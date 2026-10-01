import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/report-bug";

let nextIp = 0;
function post(body: string, ip = `192.0.2.${++nextIp}`) {
  return handler(new Request("https://example.test/api/report-bug", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-real-ip": ip },
    body,
  }));
}

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "test-only");
  vi.stubEnv("RESEND_FROM", undefined);
  vi.stubEnv("REPORT_BUG_TO", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bug-report edge handler", () => {
  it("returns JSON 500 without the email key and sends nothing", async () => {
    vi.stubEnv("RESEND_API_KEY", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post('{"message":"A map pin is misplaced"}');
    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ error: "Email backend not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-POST requests", async () => {
    const response = await handler(new Request("https://example.test/api/report-bug"));
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: "Method not allowed" });
  });

  it.each(["{", '{"message":"x"}', JSON.stringify({ message: "x".repeat(5001) })])(
    "rejects malformed JSON or invalid message lengths",
    async (body) => {
      vi.stubGlobal("fetch", vi.fn());
      expect((await post(body)).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("silently accepts honeypot submissions without sending mail", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const response = await post('{"website":"spam.test"}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses server environment variables and the client IP when sending", async () => {
    vi.stubEnv("RESEND_FROM", "Test <sender@example.test>");
    vi.stubEnv("REPORT_BUG_TO", "recipient@example.test");
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal("fetch", fetchMock);
    const response = await post(JSON.stringify({ message: "  <b>Missing pin</b>  ", context: "<map>" }), "192.0.2.100");
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
    const response = await post('{"message":"Missing pin"}');
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't send report. Please try again." });
  });

  it("limits the sixth report from the same client IP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{}')));
    for (let count = 0; count < 5; count++) {
      expect((await post('{"message":"Missing pin"}', "192.0.2.200")).status).toBe(200);
    }
    expect((await post('{"message":"Missing pin"}', "192.0.2.200")).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(5);
  });
});
