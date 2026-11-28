import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { buildApp, type App } from "../src/app.js";
import { parseHostConfig } from "../src/config.js";
import type { ExitInfo, LaunchSpec, LimitedProcess, ProcessLimitDriver } from "../src/limits/driver.js";
import type { StudioEvent } from "../src/watch.js";
import { makeHome, makeProject } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

// tinymist の代わり。データプレーンは開くだけ、制御プレーンは受け取ったメッセージを持っておき、こちらからも送れる
class FakeTinymist implements LimitedProcess {
  readonly id = "fake-tinymist";
  readonly exited: Promise<ExitInfo>;
  private resolve!: (e: ExitInfo) => void;
  private servers: WebSocketServer[];
  received: Record<string, unknown>[] = [];
  control?: WebSocket;

  constructor(ports: number[]) {
    this.exited = new Promise((r) => (this.resolve = r));
    this.servers = ports.map((port) => new WebSocketServer({ host: "127.0.0.1", port }));
    this.servers[1].on("connection", (ws) => {
      this.control = ws;
      ws.on("message", (d) => this.received.push(JSON.parse(String(d)) as Record<string, unknown>));
    });
  }

  send(msg: unknown): void {
    this.control!.send(JSON.stringify(msg));
  }

  async stop(): Promise<ExitInfo> {
    for (const s of this.servers) {
      for (const c of s.clients) c.terminate();
      s.close();
    }
    this.resolve({ reason: "stopped", code: null, signal: "SIGTERM" });
    return this.exited;
  }

  onOutput(): void {}
}

class FakeDriver implements ProcessLimitDriver {
  readonly name = "fake";
  readonly capability = "none" as const;
  procs: FakeTinymist[] = [];
  constructor(private ports: number[]) {}
  async start(_spec: LaunchSpec): Promise<LimitedProcess> {
    const p = new FakeTinymist(this.ports);
    this.procs.push(p);
    return p;
  }
  async availableMemoryBytes(): Promise<number> {
    return 8 * 1024 ** 3;
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
    await sleep(10);
  }
}

const ARTICLE = "articles/author-a/article.typ";
const BODY = ["= 見出し", "", "本文 😀 です。", '#image("images/a.png", width: 50%)', "", "1", "2", "3", "4", "5"].join("\n");

let home: string;
let root: string;
let a: App;
let d: FakeDriver;
let ws: WebSocket;
const events: StudioEvent[] = [];
let base: string;

beforeAll(async () => {
  home = makeHome();
  root = makeProject(home);
  makeProject(home, "other-book");
  fs.writeFileSync(path.join(root, ARTICLE), BODY);
  const ports = [await freePort(), await freePort()];
  const host = parseHostConfig(
    { auth: { mode: "none" }, preview: { data_plane_port: ports[0], control_plane_port: ports[1] } },
    { home, dist: home, container: false, where: "config.toml" },
  );
  d = new FakeDriver(ports);
  a = buildApp(host, d);
  await a.app.listen({ host: "127.0.0.1", port: 0 });
  base = `127.0.0.1:${(a.app.server.address() as AddressInfo).port}`;
  ws = new WebSocket(`ws://${base}/api/ws`);
  ws.on("message", (m) => events.push(JSON.parse(String(m)) as StudioEvent));
  await new Promise((r) => ws.once("open", r));
});

afterAll(async () => {
  ws.close();
  await a.preview.stop();
  await a.app.close();
  fs.rmSync(home, { recursive: true, force: true });
});

const post = (url: string, payload: Record<string, unknown>) => a.app.inject({ method: "POST", url, payload });

describe("preview control (tinymist control plane)", () => {
  it("409s while the preview is stopped", async () => {
    expect((await post("/api/preview/memory", { project: "sample-book", path: ARTICLE, content: "x" })).statusCode).toBe(409);
  });

  it("sends preview-status on start", async () => {
    const res = await post("/api/preview/start", { project: "sample-book", article: ARTICLE });
    expect(res.statusCode).toBe(200);
    await until(() => events.some((e) => e.type === "preview-status" && e.state === "running"));
    const states = events.filter((e) => e.type === "preview-status").map((e) => (e as { state: string }).state);
    expect(states).toEqual(["starting", "starting", "running"]);
    await until(() => d.procs[0]?.control !== undefined);
  });

  it("relays updateMemoryFiles / removeMemoryFiles with absolute paths", async () => {
    const p = d.procs[0];
    expect((await post("/api/preview/memory", { project: "sample-book", path: ARTICLE, content: "new" })).statusCode).toBe(204);
    expect((await post("/api/preview/memory/reset", { project: "sample-book", path: ARTICLE })).statusCode).toBe(204);
    await until(() => p.received.length === 2);
    expect(p.received).toEqual([
      { event: "updateMemoryFiles", files: { [path.join(root, ARTICLE)]: "new" } },
      { event: "removeMemoryFiles", files: [path.join(root, ARTICLE)] },
    ]);
    expect((await post("/api/preview/memory", { project: "other-book", path: ARTICLE, content: "x" })).statusCode).toBe(409);
    expect((await post("/api/preview/memory", { project: "sample-book", path: "../x.typ", content: "x" })).statusCode).toBe(400);
  });

  it("accepts memory only for existing .typ files, up to 16MB in total", async () => {
    const mem = (p: string, content: string) => post("/api/preview/memory", { project: "sample-book", path: p, content });
    expect((await mem("main.typ.bak", "x")).statusCode).toBe(400);
    expect((await mem("articles/author-a/nope.typ", "x")).statusCode).toBe(404);
    const big = "x".repeat(1900 * 1024);
    for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(root, `m${i}.typ`), "");
    for (let i = 0; i < 8; i++) expect((await mem(`m${i}.typ`, big)).statusCode).toBe(204);
    // 9 本目で 16MB を超える。既にあるものの差し替えは通る
    expect((await mem("m8.typ", big)).statusCode).toBe(413);
    expect((await mem("m0.typ", big)).statusCode).toBe(204);
    for (let i = 0; i < 8; i++) expect((await post("/api/preview/memory/reset", { project: "sample-book", path: `m${i}.typ` })).statusCode).toBe(204);
    expect((await mem("m8.typ", big)).statusCode).toBe(204);
    expect((await post("/api/preview/memory/reset", { project: "sample-book", path: "m8.typ" })).statusCode).toBe(204);
    const p = d.procs[0];
    await until(() => p.received.some((m) => m.event === "removeMemoryFiles" && String((m.files as string[])[0]).endsWith("m8.typ")));
  });

  it("converts UTF-16 positions to characters for panelScrollTo", async () => {
    const p = d.procs[0];
    p.received.length = 0;
    // 3 行目 "本文 😀 です。" の "で"（UTF-16 で 6、文字で 5）
    expect((await post("/api/preview/scroll", { project: "sample-book", path: ARTICLE, line: 2, character: 6 })).statusCode).toBe(204);
    await until(() => p.received.length === 1);
    expect(p.received[0]).toEqual({ event: "panelScrollTo", filepath: path.join(root, ARTICLE), line: 2, character: 5 });
    expect((await post("/api/preview/scroll", { project: "sample-book", path: ARTICLE, line: -1, character: 0 })).statusCode).toBe(400);
  });

  it("turns editorScrollTo into preview-jump, with the image call it hits", async () => {
    const p = d.procs[0];
    events.length = 0;
    const imgLine = 3;
    const col = BODY.split("\n")[imgLine].indexOf("a.png");
    p.send({ event: "editorScrollTo", filepath: path.join(root, ARTICLE), start: [imgLine, col], end: [imgLine, col + 5] });
    await until(() => events.some((e) => e.type === "preview-jump"));
    const jump = events.find((e) => e.type === "preview-jump")!;
    expect(jump).toMatchObject({
      project: "sample-book",
      path: ARTICLE,
      start: { line: 3, character: col },
      end: { line: 3, character: col + 5 },
      image: { src: "images/a.png", width: "50%", editable: true },
    });
    expect((jump as { image: { nearest?: boolean } }).image.nearest).toBeUndefined();

    // 範囲外だが 2 行下 → nearest。文字（コードポイント）→ UTF-16 の変換もここで確かめる
    events.length = 0;
    p.send({ event: "editorScrollTo", filepath: path.join(root, ARTICLE), start: [2, 5], end: [2, 6] });
    await until(() => events.some((e) => e.type === "preview-jump"));
    expect(events.find((e) => e.type === "preview-jump")).toMatchObject({ start: { line: 2, character: 6 }, image: { src: "images/a.png", nearest: true } });

    // 5 行以上離れていれば image は付かない
    events.length = 0;
    p.send({ event: "editorScrollTo", filepath: path.join(root, ARTICLE), start: [9, 0], end: [9, 1] });
    await until(() => events.some((e) => e.type === "preview-jump"));
    expect(events.find((e) => e.type === "preview-jump")).not.toHaveProperty("image");

    // 名前が .. で始まるだけのファイルはプロジェクトの中
    fs.writeFileSync(path.join(root, "..notes.typ"), "x\r\ny\u2028z #image(\"n.png\")\n");
    events.length = 0;
    p.send({ event: "editorScrollTo", filepath: path.join(root, "..notes.typ"), start: [2, 2], end: [2, 3] });
    await until(() => events.some((e) => e.type === "preview-jump"));
    // \r\n と U+2028 を改行として数える（typst と同じ）
    expect(events.find((e) => e.type === "preview-jump")).toMatchObject({ path: "..notes.typ", start: { line: 2, character: 2 }, image: { src: "n.png", line: 3 } });

    // プロジェクトの外のファイルは送らない
    events.length = 0;
    p.send({ event: "editorScrollTo", filepath: "/usr/share/x.typ", start: [0, 0], end: [0, 1] });
    await sleep(100);
    expect(events.filter((e) => e.type === "preview-jump")).toEqual([]);
  });

  it("uses the memory buffer for matching after updateMemoryFiles", async () => {
    const p = d.procs[0];
    const edited = '#image("b.png")\n' + BODY;
    expect((await post("/api/preview/memory", { project: "sample-book", path: ARTICLE, content: edited })).statusCode).toBe(204);
    events.length = 0;
    p.send({ event: "editorScrollTo", filepath: path.join(root, ARTICLE), start: [0, 3], end: [0, 4] });
    await until(() => events.some((e) => e.type === "preview-jump"));
    expect(events.find((e) => e.type === "preview-jump")).toMatchObject({ image: { src: "b.png" } });
  });

  it("sends preview-compile, and preview-status when the result changes", async () => {
    const p = d.procs[0];
    events.length = 0;
    p.send({ event: "compileStatus", kind: "Compiling" });
    p.send({ event: "compileStatus", kind: "CompileError" });
    p.send({ event: "compileStatus", kind: "CompileError" });
    p.send({ event: "compileStatus", kind: "CompileSuccess" });
    await until(() => events.filter((e) => e.type === "preview-compile").length === 3);
    expect(events.filter((e) => e.type === "preview-compile")).toEqual([
      { type: "preview-compile", project: "sample-book", ok: false },
      { type: "preview-compile", project: "sample-book", ok: false },
      { type: "preview-compile", project: "sample-book", ok: true },
    ]);
    expect(events.filter((e) => e.type === "preview-status").map((e) => (e as { compile: { ok: boolean } }).compile.ok)).toEqual([false, true]);
    expect(a.preview.status().compile).toMatchObject({ ok: true });
  });

  it("sends preview-status on stop", async () => {
    events.length = 0;
    await post("/api/preview/stop", {});
    await until(() => events.some((e) => e.type === "preview-status" && e.state === "stopped"));
    expect(events.filter((e) => e.type === "preview-status").map((e) => (e as { state: string }).state)).toEqual(["stopping", "stopped"]);
  });
});
