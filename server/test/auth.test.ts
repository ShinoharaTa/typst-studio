import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { checkAccess } from "../src/auth.js";
import { parseHostConfig, type HostConfig } from "../src/config.js";
import { NoneDriver } from "../src/limits/none.js";
import { rewriteUpgradeHeaders } from "../src/preview/relay.js";

process.env.LOG_LEVEL = "silent";

const ctx = { home: "/h", dist: "/h", container: false, where: "config.toml" };
const PUBLIC = "https://studio.example.ts.net:8445";
const tailscale = (publicUrl = PUBLIC): HostConfig =>
  parseHostConfig(
    { server: { public_url: publicUrl }, auth: { mode: "tailscale", allow_users: ["author-a@example.com"] } },
    ctx,
  );
const none = (): HostConfig => parseHostConfig({ server: { public_url: PUBLIC }, auth: { mode: "none" } }, ctx);
const allowed = { "tailscale-user-login": "author-a@example.com" };

describe("checkAccess (spec 7.2)", () => {
  const get = (url: string, headers = {}) => ({ method: "GET", url, headers });

  it("allows a listed Tailscale user", () => {
    expect(checkAccess(tailscale(), get("/", allowed))).toEqual({ ok: true });
    expect(checkAccess(tailscale(), get("/api/preview/status", allowed)).ok).toBe(true);
  });

  it("rejects an unlisted Tailscale user with 403, on every path", () => {
    for (const p of ["/", "/api/preview/status", "/mcp", "/healthz"]) {
      expect(checkAccess(tailscale(), get(p, { "tailscale-user-login": "someone@example.com" }))).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it("allows only /mcp and /healthz without the header", () => {
    expect(checkAccess(tailscale(), get("/healthz")).ok).toBe(true);
    expect(checkAccess(tailscale(), get("/mcp")).ok).toBe(true);
    expect(checkAccess(tailscale(), get("/healthz?x=1")).ok).toBe(true);
    for (const p of ["/", "/preview/", "/api/preview/status", "/mcp/x", "/healthz/x"]) {
      expect(checkAccess(tailscale(), get(p))).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("does not authenticate in auth.mode = none", () => {
    expect(checkAccess(none(), get("/api/preview/status")).ok).toBe(true);
  });
});

describe("checkAccess Origin (spec 7.3)", () => {
  const post = (url: string, headers = {}) => ({ method: "POST", url, headers });

  it("allows state-changing requests from the public_url origin", () => {
    expect(checkAccess(tailscale(), post("/api/preview/stop", { ...allowed, origin: PUBLIC })).ok).toBe(true);
  });

  it("rejects other origins with 403", () => {
    for (const origin of ["https://evil.example", "https://studio.example.ts.net", "http://127.0.0.1:8796", "null"]) {
      expect(checkAccess(tailscale(), post("/api/preview/stop", { ...allowed, origin }))).toMatchObject({
        ok: false,
        status: 403,
      });
      expect(checkAccess(none(), post("/api/preview/stop", { origin }))).toMatchObject({ ok: false, status: 403 });
    }
  });

  it("follows public_url", () => {
    const h = tailscale("https://other.example.ts.net");
    expect(checkAccess(h, post("/api/preview/stop", { ...allowed, origin: "https://other.example.ts.net" })).ok).toBe(true);
    expect(checkAccess(h, post("/api/preview/stop", { ...allowed, origin: PUBLIC })).ok).toBe(false);
  });

  it("allows a missing Origin only in auth.mode = none (curl) or on /mcp", () => {
    expect(checkAccess(none(), post("/api/preview/stop")).ok).toBe(true);
    expect(checkAccess(tailscale(), post("/api/preview/stop", allowed))).toMatchObject({ ok: false, status: 403 });
    expect(checkAccess(tailscale(), post("/mcp")).ok).toBe(true);
  });

  it("does not check Origin on safe methods", () => {
    expect(checkAccess(tailscale(), { method: "GET", url: "/", headers: { ...allowed, origin: "https://evil.example" } }).ok).toBe(
      true,
    );
  });
});

describe("app with auth", () => {
  let app: ReturnType<typeof buildApp>["app"];
  let port: number;
  beforeAll(async () => {
    app = buildApp(tailscale(), new NoneDriver()).app;
    await app.listen({ host: "127.0.0.1", port: 0 });
    port = (app.server.address() as AddressInfo).port;
  });
  afterAll(() => app.close());

  it("applies the rules to HTTP routes", async () => {
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/preview/status" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/preview/status", headers: allowed })).statusCode).toBe(200);
    expect(
      (await app.inject({ url: "/api/preview/status", headers: { "tailscale-user-login": "x@example.com" } })).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/preview/stop", headers: allowed })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/api/preview/stop", headers: { ...allowed, origin: PUBLIC } })).statusCode,
    ).toBe(200);
  });

  const upgrade = (headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGVzdA==", ...headers },
      });
      req.on("response", (res) => resolve(res.statusCode ?? 0));
      req.on("upgrade", (res) => resolve(res.statusCode ?? 0));
      req.on("error", reject);
      req.end();
    });

  it("applies the rules to WebSocket upgrades", async () => {
    expect(await upgrade({})).toBe(401);
    expect(await upgrade({ "tailscale-user-login": "x@example.com" })).toBe(403);
    // 認証は通り、プレビューが動いていないので 503
    expect(await upgrade(allowed)).toBe(503);
  });
});

describe("relay strips Tailscale identity headers", () => {
  it("does not pass Tailscale-User-* to tinymist", () => {
    const h = rewriteUpgradeHeaders(
      [
        "Host", "studio.example.ts.net",
        "Tailscale-User-Login", "author-a@example.com",
        "Tailscale-User-Name", "Author A",
        "Tailscale-User-Profile-Pic", "https://example.com/a.png",
        "Upgrade", "websocket",
      ],
      23625,
    );
    expect(Object.keys(h).filter((k) => k.startsWith("tailscale-"))).toEqual([]);
    expect(h.upgrade).toBe("websocket");
  });
});
