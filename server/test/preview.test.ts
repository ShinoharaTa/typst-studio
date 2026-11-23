import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { parseHostConfig, type HostConfig } from "../src/config.js";
import type { ExitInfo, LaunchSpec, LimitedProcess, ProcessLimitDriver } from "../src/limits/driver.js";
import { PreviewManager } from "../src/preview/manager.js";

// tinymist の代わりに、データ / コントロールプレーンの WebSocket を開くだけの偽プロセス
class FakeProc implements LimitedProcess {
  readonly id: string;
  readonly exited: Promise<ExitInfo>;
  private resolve!: (e: ExitInfo) => void;
  private servers: WebSocketServer[] = [];

  constructor(n: number, ports: number[] | undefined) {
    this.id = `fake-${n}`;
    this.exited = new Promise((r) => (this.resolve = r));
    for (const port of ports ?? []) this.servers.push(new WebSocketServer({ host: "127.0.0.1", port }));
  }

  exit(info: ExitInfo): void {
    for (const s of this.servers) {
      for (const c of s.clients) c.terminate();
      s.close();
    }
    this.resolve(info);
  }

  async stop(): Promise<ExitInfo> {
    this.exit({ reason: "stopped", code: null, signal: "SIGTERM" });
    return this.exited;
  }

  onOutput(): void {}
}

class FakeDriver implements ProcessLimitDriver {
  readonly name = "fake";
  readonly capability = "none" as const;
  procs: FakeProc[] = [];
  // false にすると、ポートを開く前に limit で終わる（起動途中の上限停止）
  listen = true;

  constructor(private ports: number[]) {}

  async start(_spec: LaunchSpec): Promise<LimitedProcess> {
    const p = new FakeProc(this.procs.length, this.listen ? this.ports : undefined);
    this.procs.push(p);
    if (!this.listen) setTimeout(() => p.exit({ reason: "limit", code: null, signal: "SIGKILL" }), 20);
    return p;
  }

  async availableMemoryBytes(): Promise<number> {
    return 0;
  }

  async cleanupStale(): Promise<string[]> {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  const s = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise((r) => s.once("listening", r));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await sleep(20);
  }
}

describe("PreviewManager auto restart (spec 3.8.1)", () => {
  let home: string;
  let host: HostConfig;
  let ports: number[];
  const article = "articles/author-a/article.typ";
  beforeAll(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ts-preview-"));
    const root = path.join(home, "projects", "sample-book");
    fs.mkdirSync(path.join(root, "articles", "author-a"), { recursive: true });
    fs.writeFileSync(path.join(root, "main.typ"), "");
    fs.writeFileSync(path.join(root, article), "");
    fs.writeFileSync(
      path.join(root, "typst-studio.toml"),
      '[project]\ntypst = "0.14.2"\n[book]\nentry = "main.typ"\n[articles]\nglob = "articles/**/article.typ"\n',
    );
    ports = [await freePort(), await freePort()];
    host = parseHostConfig(
      { auth: { mode: "none" }, preview: { data_plane_port: ports[0], control_plane_port: ports[1] } },
      { home, dist: home, container: false, where: "config.toml" },
    );
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));
  const log = Fastify({ logger: false }).log;

  it("restarts once after a limit, and not after the second", async () => {
    const driver = new FakeDriver(ports);
    const m = new PreviewManager(host, driver, log);
    await m.start("sample-book", article);
    expect(m.status()).toMatchObject({ state: "running", unit: "fake-0", autoRestartsLeft: 1 });

    driver.procs[0].exit({ reason: "limit", code: null, signal: "SIGKILL" });
    await until(() => m.status().unit === "fake-1" && m.isRunning());
    expect(m.status()).toMatchObject({ autoRestartsLeft: 0, lastExit: { reason: "limit" } });

    driver.procs[1].exit({ reason: "limit", code: null, signal: "SIGKILL" });
    await until(() => m.status().state === "stopped");
    await sleep(200);
    expect(driver.procs).toHaveLength(2);
    expect(m.status()).toMatchObject({ state: "stopped", lastExit: { reason: "limit" } });

    // 明示的な start で 1 回分が戻る
    await m.start("sample-book", article);
    expect(m.status()).toMatchObject({ state: "running", autoRestartsLeft: 1 });
    await m.stop();
  });

  it("does not restart when the limit hits before the preview is running", async () => {
    const driver = new FakeDriver(ports);
    driver.listen = false;
    const m = new PreviewManager(host, driver, log);
    await expect(m.start("sample-book", article)).rejects.toThrow();
    await sleep(300);
    expect(driver.procs).toHaveLength(1);
    expect(m.status()).toMatchObject({ state: "stopped", lastExit: { reason: "limit" } });
  });

  it("does not restart after other exit reasons", async () => {
    const driver = new FakeDriver(ports);
    const m = new PreviewManager(host, driver, log);
    await m.start("sample-book", article);
    driver.procs[0].exit({ reason: "error", code: 1, signal: null });
    await until(() => m.status().state === "stopped");
    await sleep(200);
    expect(driver.procs).toHaveLength(1);
  });
});
