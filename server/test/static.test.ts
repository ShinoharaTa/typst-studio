import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, DEFAULT_WEB_DIST, type App } from "../src/app.js";
import { parseHostConfig, type HostConfig } from "../src/config.js";
import { NoneDriver } from "../src/limits/none.js";
import { makeHome } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

const PUBLIC = "https://studio.example.test:8445";
const INDEX = '<!doctype html><div id="root"></div><script type="module" src="/assets/index-abc123.js"></script>';
let home: string;
let web: string;

const hostFor = (mode: "none" | "tailscale"): HostConfig =>
  parseHostConfig(
    { server: { public_url: PUBLIC }, auth: mode === "tailscale" ? { mode, allow_users: ["author-a@example.com"] } : { mode } },
    { home, dist: home, container: false, where: "config.toml" },
  );

const apps: App[] = [];
async function make(mode: "none" | "tailscale", webDist: string | null): Promise<App> {
  const a = buildApp(hostFor(mode), new NoneDriver(path.join(home, "state", "children")), { webDist });
  await a.app.ready();
  apps.push(a);
  return a;
}

beforeAll(() => {
  home = makeHome();
  fs.mkdirSync(path.join(home, "projects"));
  web = path.join(home, "web-dist");
  fs.mkdirSync(path.join(web, "assets"), { recursive: true });
  fs.writeFileSync(path.join(web, "index.html"), INDEX);
  fs.writeFileSync(path.join(web, "assets", "index-abc123.js"), "console.log(1);\n");
  fs.writeFileSync(path.join(web, "assets", "pdf.worker.min-def456.mjs"), "self.onmessage = () => {};\n");
  // web のビルドが作る事前圧縮
  const big = "console.log('compressed');\n".repeat(100);
  fs.writeFileSync(path.join(web, "assets", "big-aaa111.js"), big);
  fs.writeFileSync(path.join(web, "assets", "big-aaa111.js.gz"), zlib.gzipSync(big));
  fs.writeFileSync(path.join(web, "assets", "big-aaa111.js.br"), zlib.brotliCompressSync(big));
});

afterAll(async () => {
  for (const a of apps) await a.app.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("web UI", () => {
  it("defaults to web/dist at the repository root", () => {
    expect(DEFAULT_WEB_DIST).toBe(path.resolve(import.meta.dirname, "..", "..", "web", "dist"));
  });

  it("serves index.html at / without long caching", async () => {
    const a = await make("none", web);
    const res = await a.app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toBe(INDEX);
  });

  it("serves hashed assets (including the pdf.js worker) as JavaScript with immutable caching", async () => {
    const a = await make("none", web);
    const js = await a.app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const worker = await a.app.inject({ method: "GET", url: "/assets/pdf.worker.min-def456.mjs" });
    expect(worker.statusCode).toBe(200);
    expect(worker.headers["content-type"]).toMatch(/javascript/);
    expect(worker.body).toContain("onmessage");
  });

  it("falls back to index.html for other GET / HEAD paths (SPA)", async () => {
    const a = await make("none", web);
    for (const url of ["/p/sample-book", "/p/sample-book/edit/x?tab=book", "/apix", "/previewer", "/healthzz"]) {
      const res = await a.app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(INDEX);
      expect(res.headers["cache-control"], url).toBe("no-cache");
    }
    const head = await a.app.inject({ method: "HEAD", url: "/p/sample-book" });
    expect(head.statusCode).toBe(200);
    expect(head.headers["content-type"]).toMatch(/^text\/html/);
  });

  it("serves the pre-compressed files by Accept-Encoding", async () => {
    const a = await make("none", web);
    const br = await a.app.inject({ method: "GET", url: "/assets/big-aaa111.js", headers: { "accept-encoding": "br, gzip" } });
    expect(br.statusCode).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.headers["content-type"]).toMatch(/javascript/);
    expect(br.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(zlib.brotliDecompressSync(br.rawPayload).toString()).toContain("compressed");
    const gz = await a.app.inject({ method: "GET", url: "/assets/big-aaa111.js", headers: { "accept-encoding": "gzip" } });
    expect(gz.headers["content-encoding"]).toBe("gzip");
    const plain = await a.app.inject({ method: "GET", url: "/assets/big-aaa111.js", headers: { "accept-encoding": "identity" } });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body).toContain("compressed");
  });

  it("does not fall back under /api, /preview, /healthz and /assets, nor for other methods", async () => {
    const a = await make("none", web);
    for (const url of ["/api", "/api/nope", "/api/projects/sample-book/nope", "/preview", "/preview/x.js", "/healthz/x", "/assets/missing-000.js", "/assets"]) {
      const res = await a.app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).toMatch(/^application\/json/);
      expect(res.json().error, url).toBe("Not Found");
    }
    const post = await a.app.inject({ method: "POST", url: "/p/sample-book", payload: {} });
    expect(post.statusCode).toBe(404);
  });

  it("keeps the existing routes", async () => {
    const a = await make("none", web);
    expect((await a.app.inject({ method: "GET", url: "/healthz" })).json()).toEqual({ ok: true });
    expect((await a.app.inject({ method: "GET", url: "/api/preview/status" })).json()).toMatchObject({ state: "stopped" });
    expect((await a.app.inject({ method: "GET", url: "/api/projects" })).json()).toEqual([]);
    // プレビュー停止中の /preview/ は今までどおり 503
    expect((await a.app.inject({ method: "GET", url: "/preview/" })).statusCode).toBe(503);
  });

  it("does not serve files outside the dist directory", async () => {
    fs.writeFileSync(path.join(home, "secret.txt"), "secret\n");
    const a = await make("none", web);
    for (const url of ["/../secret.txt", "/assets/../../secret.txt", "/%2e%2e/secret.txt"]) {
      const res = await a.app.inject({ method: "GET", url });
      expect(res.body, url).not.toContain("secret");
    }
  });

  it("applies authentication to the UI too", async () => {
    const a = await make("tailscale", web);
    expect((await a.app.inject({ method: "GET", url: "/" })).statusCode).toBe(401);
    expect((await a.app.inject({ method: "GET", url: "/p/sample-book" })).statusCode).toBe(401);
    const ok = await a.app.inject({ method: "GET", url: "/", headers: { "tailscale-user-login": "author-a@example.com" } });
    expect(ok.statusCode).toBe(200);
  });

  it("returns 404 for / when the UI is not built, and when disabled", async () => {
    for (const dist of [path.join(home, "missing"), null]) {
      const a = await make("none", dist);
      const res = await a.app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(404);
      expect((await a.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    }
  });
});
