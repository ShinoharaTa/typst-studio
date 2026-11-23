import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp, type App } from "../src/app.js";
import { parseHostConfig } from "../src/config.js";
import { sha256 } from "../src/files.js";
import { NoneDriver } from "../src/limits/none.js";
import { git, makeHome, makeProject, PROJECT_TOML } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

const PUBLIC = "https://studio.example.test:8445";

type Msg = Record<string, unknown> & { type: string };

class Client {
  msgs: Msg[] = [];
  private waiters: (() => void)[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (d) => {
      this.msgs.push(JSON.parse(d.toString()) as Msg);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  // pred に合うメッセージが届くまで待つ（届いた時刻までの ms も返す）
  async waitFor(pred: (m: Msg) => boolean, timeoutMs = 5000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = this.msgs.find(pred);
      if (m) return m;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; got ${JSON.stringify(this.msgs)}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, left);
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  clear(): void {
    this.msgs = [];
  }
}

function connect(port: number, origin?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, origin ? { origin } : {});
    const c = new Client(ws);
    ws.once("open", () => resolve(c));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("/api/ws notifications", () => {
  let home: string;
  let root: string;
  let a: App;
  let port: number;
  let c: Client;

  beforeAll(async () => {
    home = makeHome();
    root = makeProject(home);
    git(root, "branch", "other");
    const host = parseHostConfig({ server: { public_url: PUBLIC }, auth: { mode: "external" } }, { home, dist: home, container: false, where: "config.toml" });
    a = buildApp(host, new NoneDriver(path.join(home, "state", "children")));
    await a.app.listen({ host: "127.0.0.1", port: 0 });
    port = (a.app.server.address() as AddressInfo).port;
    await a.watchers.startAll();
    c = await connect(port, PUBLIC);
  });

  afterAll(async () => {
    c?.ws.close();
    await a.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("an external edit sends file-changed and git-changed (uncommitted +1) within 5s", async () => {
    c.clear();
    const t0 = Date.now();
    fs.writeFileSync(path.join(root, "main.typ"), "= edited outside\n");
    const fc = await c.waitFor((m) => m.type === "file-changed" && m.path === "main.typ");
    expect(fc).toEqual({ type: "file-changed", project: "sample-book", path: "main.typ", rev: sha256(Buffer.from("= edited outside\n")) });
    const gc = await c.waitFor((m) => m.type === "git-changed");
    expect(gc).toMatchObject({ project: "sample-book", branch: "main", uncommitted: 1 });
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("does not resend when the content (rev) did not change", async () => {
    await sleep(400);
    c.clear();
    fs.writeFileSync(path.join(root, "main.typ"), "= edited outside\n");
    fs.writeFileSync(path.join(root, "marker.txt"), "m\n");
    await c.waitFor((m) => m.type === "file-changed" && m.path === "marker.txt");
    await sleep(300);
    expect(c.msgs.filter((m) => m.type === "file-changed" && m.path === "main.typ")).toEqual([]);
    fs.rmSync(path.join(root, "marker.txt"));
    await c.waitFor((m) => m.type === "file-removed" && m.path === "marker.txt");
  });

  it("studio's own PUT is notified with the same rev it returned", async () => {
    c.clear();
    const f = (await a.app.inject({ method: "GET", url: "/api/projects/sample-book/file?path=main.typ" })).json() as { rev: string };
    const res = await a.app.inject({
      method: "PUT",
      url: "/api/projects/sample-book/file",
      headers: { origin: PUBLIC },
      payload: { path: "main.typ", content: "= from studio\n", baseRev: f.rev },
    });
    const { rev } = res.json() as { rev: string };
    const fc = await c.waitFor((m) => m.type === "file-changed" && m.path === "main.typ");
    expect(fc.rev).toBe(rev);
    // 一時ファイルは通知しない
    await sleep(300);
    expect(c.msgs.filter((m) => String(m.path).includes(".tmp"))).toEqual([]);
  });

  it("an external git switch sends one git-changed within 5s, and articles-changed once", async () => {
    git(root, "checkout", "-q", "--", ".");
    // other ブランチに記事を足しておく（main には無い）
    git(root, "switch", "-q", "other");
    for (let i = 0; i < 30; i++) {
      fs.mkdirSync(path.join(root, "articles", `author-${i}`), { recursive: true });
      fs.writeFileSync(path.join(root, "articles", `author-${i}`, "article.typ"), `= ${i}\n`);
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "articles");
    git(root, "switch", "-q", "main");
    await sleep(1500);
    c.clear();

    const t0 = Date.now();
    git(root, "switch", "-q", "other");
    const gc = await c.waitFor((m) => m.type === "git-changed" && m.branch === "other");
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(gc).toMatchObject({ project: "sample-book", detached: false, uncommitted: 0 });
    await c.waitFor((m) => m.type === "articles-changed");
    await sleep(1500);
    expect(c.msgs.filter((m) => m.type === "articles-changed")).toHaveLength(1);
    expect(c.msgs.filter((m) => m.type === "file-changed").length).toBe(30);

    const list = (await a.app.inject({ method: "GET", url: "/api/projects/sample-book/articles" })).json() as unknown[];
    expect(list).toHaveLength(31);
  });

  it("reloads typst-studio.toml and reports config errors", async () => {
    c.clear();
    fs.writeFileSync(path.join(root, "typst-studio.toml"), PROJECT_TOML + "\n[bogus]\n");
    const bad = await c.waitFor((m) => m.type === "config-changed");
    expect(bad.error).toMatch(/unknown key "bogus"/);
    c.clear();
    fs.writeFileSync(path.join(root, "typst-studio.toml"), PROJECT_TOML);
    const ok = await c.waitFor((m) => m.type === "config-changed");
    expect(ok).toEqual({ type: "config-changed", project: "sample-book" });
  });

  it("rejects /api/ws without Origin or with another Origin (auth.mode = external)", async () => {
    await expect(connect(port)).rejects.toThrow("status 403");
    await expect(connect(port, "https://evil.example")).rejects.toThrow("status 403");
  });

  it("does not hand /api/ws to the tinymist relay, nor / to /api/ws", async () => {
    // プレビューは動いていないので、/ は 503（中継側）
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { origin: PUBLIC });
        ws.once("open", res);
        ws.once("unexpected-response", (_q, r) => rej(new Error(`status ${r.statusCode}`)));
      }),
    ).rejects.toThrow("status 503");
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws/x`, { origin: PUBLIC });
        ws.once("open", res);
        ws.once("unexpected-response", (_q, r) => rej(new Error(`status ${r.statusCode}`)));
      }),
    ).rejects.toThrow("status 404");
  });
});
