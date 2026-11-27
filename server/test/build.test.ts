import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { BuildManager, hasNewerSources, MEMORY_MARGIN_BYTES, parseDiagnostics, parseRange, type BuildStatus } from "../src/build.js";
import { parseHostConfig, parseSize, type HostConfig } from "../src/config.js";
import type { ExitInfo, LaunchSpec, LimitedProcess, ProcessLimitDriver } from "../src/limits/driver.js";
import { NoneDriver } from "../src/limits/none.js";
import { makeHome, makeProject } from "./helpers/repo.js";

process.env.LOG_LEVEL = "silent";

const TOML = `[project]
typst = "0.14.2"

[book]
entry = "main.typ"
preview_profile = "print"

[articles]
glob = "articles/**/article.typ"

[profiles.print]
entry = "main.typ"
output = "main.pdf"

[profiles.ebook]
entry = "main.typ"
inputs = { EBOOK = "true" }
output = "ebook-body.pdf"
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await sleep(10);
  }
}

// typst の代わり。finish() で終わらせる。ok なら出力先に PDF らしいものを書く
class FakeProc implements LimitedProcess {
  readonly id: string;
  readonly exited: Promise<ExitInfo>;
  private resolve!: (e: ExitInfo) => void;
  private cbs: ((s: "stdout" | "stderr", c: Buffer) => void)[] = [];

  constructor(
    n: number,
    readonly spec: LaunchSpec,
  ) {
    this.id = `fake-build-${n}`;
    this.exited = new Promise((r) => (this.resolve = r));
  }

  finish(reason: ExitInfo["reason"], stderr = ""): void {
    if (stderr) for (const cb of this.cbs) cb("stderr", Buffer.from(stderr));
    if (reason === "ok") fs.writeFileSync(this.spec.args.at(-1)!, "%PDF-1.7 fake");
    this.resolve({ reason, code: reason === "ok" ? 0 : 1, signal: null });
  }

  async stop(): Promise<ExitInfo> {
    this.resolve({ reason: "stopped", code: null, signal: "SIGTERM" });
    return this.exited;
  }

  onOutput(cb: (s: "stdout" | "stderr", c: Buffer) => void): void {
    this.cbs.push(cb);
  }
}

class FakeDriver implements ProcessLimitDriver {
  readonly name = "fake";
  readonly capability = "none" as const;
  procs: FakeProc[] = [];
  available = 8 * 1024 ** 3;

  async start(spec: LaunchSpec): Promise<LimitedProcess> {
    const p = new FakeProc(this.procs.length, spec);
    this.procs.push(p);
    return p;
  }

  async availableMemoryBytes(): Promise<number> {
    return this.available;
  }

  async cleanupStale(): Promise<string[]> {
    return [];
  }
}

describe("parseDiagnostics", () => {
  it("reads typst --diagnostic-format short, attaching help lines", () => {
    const out = [
      "sub/a.typ:2:7: error: file not found (searched at /x/sub/nope.png)",
      "main.typ:2:9: help: error occurred while importing this module",
      "main.typ:3:12: warning: unknown font family: nosuchfont",
      "downloading @preview/foo:0.1.0",
      "@preview/foo:0.1.0/lib.typ:1:8: error: package problem",
      "error: input file not found (searched at ../nofile.typ)",
    ].join("\n");
    expect(parseDiagnostics(out)).toEqual([
      {
        severity: "error",
        file: "sub/a.typ",
        line: 2,
        column: 7,
        message: "file not found (searched at /x/sub/nope.png)\nhelp: main.typ:2:9: error occurred while importing this module",
      },
      { severity: "warning", file: "main.typ", line: 3, column: 12, message: "unknown font family: nosuchfont" },
      { severity: "error", file: null, line: null, column: null, message: "@preview/foo:0.1.0/lib.typ:1:8: package problem" },
      { severity: "error", file: null, line: null, column: null, message: "input file not found (searched at ../nofile.typ)" },
    ]);
  });
});

describe("parseRange", () => {
  it("parses a single byte range", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
  });
});

describe("BuildManager", () => {
  let home: string;
  let host: HostConfig;
  const log = Fastify({ logger: false }).log;
  beforeAll(() => {
    home = makeHome();
    makeProject(home, "sample-book");
    makeProject(home, "other-book");
    for (const n of ["sample-book", "other-book"]) fs.writeFileSync(path.join(home, "projects", n, "typst-studio.toml"), TOML);
    host = parseHostConfig({ auth: { mode: "none" }, build: { memory_max: "1000M", keep_generations: 2 } }, { home, dist: home, container: false, where: "config.toml" });
  });
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  let m: BuildManager | undefined;
  afterEach(async () => {
    await m?.close();
    m = undefined;
  });

  it("passes the profile, fonts and limits to typst compile", async () => {
    const d = new FakeDriver();
    m = new BuildManager(host, d, log);
    const st = await m.request("sample-book", "ebook");
    expect(st).toMatchObject({ project: "sample-book", profile: "ebook", state: "running", stale: false });
    const spec = d.procs[0].spec;
    const root = fs.realpathSync(path.join(home, "projects", "sample-book"));
    expect(spec.command).toBe(path.join(home, "bin", "typst"));
    expect(spec.cwd).toBe(root);
    expect(spec.args.slice(0, 7)).toEqual(["compile", "--root", root, "--diagnostic-format", "short", "--format", "pdf"]);
    expect(spec.args).toContain("--input");
    expect(spec.args[spec.args.indexOf("--input") + 1]).toBe("EBOOK=true");
    expect(spec.args[spec.args.indexOf("--font-path") + 1]).toBe(path.join(home, "fonts"));
    expect(spec.args.at(-2)).toBe("main.typ");
    expect(spec.limits).toEqual({ memoryMax: "1000M", swapMax: "0", timeoutSeconds: 300, addressSpace: true });
    d.procs[0].finish("ok");
    await until(() => d.procs.length === 1);
  });

  it("defaults to book.preview_profile, and rejects unknown profiles", async () => {
    const d = new FakeDriver();
    m = new BuildManager(host, d, log);
    expect((await m.request("sample-book")).profile).toBe("print");
    await expect(m.request("sample-book", "nope")).rejects.toThrow(/not defined/);
    d.procs[0].finish("ok");
  });

  it("runs one build at a time across projects, with at most one waiting", async () => {
    const d = new FakeDriver();
    const events: BuildStatus[] = [];
    m = new BuildManager(host, d, log, (st) => events.push(st));
    await m.request("sample-book", "print");
    expect((await m.request("other-book", "print")).state).toBe("queued");
    // 待ちが埋まっているので、これは積まれない
    expect((await m.request("sample-book", "ebook")).state).toBe("idle");
    expect((await m.request("sample-book", "print")).state).toBe("running");
    expect(d.procs).toHaveLength(1);

    d.procs[0].finish("ok");
    await until(() => d.procs.length === 2);
    expect(d.procs[1].spec.cwd).toContain("other-book");
    expect((await m.statusFor("other-book", "print")).state).toBe("running");
    d.procs[1].finish("ok");
    await until(() => events.some((e) => e.project === "other-book" && e.state === "idle" && e.last?.ok === true));
    expect(d.procs).toHaveLength(2);
    expect(events.map((e) => `${e.project}/${e.profile}:${e.state}`)).toEqual([
      "sample-book/print:running",
      "other-book/print:queued",
      "sample-book/print:idle",
      "other-book/print:running",
      "other-book/print:idle",
    ]);
  });

  it("refuses to start without build.memory_max + 300MB free (503 nomem)", async () => {
    const d = new FakeDriver();
    d.available = parseSize("1000M") + MEMORY_MARGIN_BYTES - 1;
    m = new BuildManager(host, d, log);
    await expect(m.request("sample-book", "print")).rejects.toMatchObject({
      status: 503,
      extra: { reason: "nomem", available: d.available, required: d.available + 1 },
    });
    expect(d.procs).toHaveLength(0);
    // 待ちから始めるときに足りなければ nomem の結果を残す
    d.available += 1;
    await m.request("sample-book", "print");
    await m.request("sample-book", "ebook");
    d.available -= 1;
    d.procs[0].finish("ok");
    await until(() => m!["busy"] === false);
    const st = await m.statusFor("sample-book", "ebook");
    expect(st.last).toMatchObject({ ok: false, reason: "nomem", durationMs: 0 });
    expect(d.procs).toHaveLength(1);
  });

  it("records diagnostics, keeps the last success on failure, and prunes to 2 generations", async () => {
    const d = new FakeDriver();
    m = new BuildManager(host, d, log);
    const dir = path.join(home, "builds", "sample-book");
    fs.rmSync(dir, { recursive: true, force: true });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      await m.request("sample-book", "print");
      const p = d.procs.at(-1)!;
      p.finish("ok", "main.typ:1:1: warning: something\n");
      await until(() => m!["busy"] === false);
      ids.push((await m.statusFor("sample-book", "print")).last!.buildId);
      await sleep(5);
    }
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(ids.slice(1).map((id) => `print-${id}.pdf`));
    const ok = (await m.statusFor("sample-book", "print")).last!;
    expect(ok).toMatchObject({ ok: true, reason: "ok", warnings: 1, sizeBytes: 13, pdfUrl: `/api/projects/sample-book/builds/print-${ids[2]}.pdf` });

    await m.request("sample-book", "print");
    d.procs.at(-1)!.finish("error", "main.typ:3:5: error: unknown variable: x\n");
    await until(() => m!["busy"] === false);
    const st = await m.statusFor("sample-book", "print");
    expect(st.last).toMatchObject({ ok: false, reason: "error", diagnostics: [{ severity: "error", file: "main.typ", line: 3, column: 5, message: "unknown variable: x" }] });
    expect(st.lastSuccess?.buildId).toBe(ids[2]);
    expect(st.last?.pdfUrl).toBeUndefined();
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("."))).toEqual([]);
  });

  it("reports stale when a .typ or image is newer than the last success", async () => {
    const d = new FakeDriver();
    m = new BuildManager(host, d, log);
    await m.request("other-book", "ebook");
    d.procs[0].finish("ok");
    await until(() => m!["busy"] === false);
    expect((await m.statusFor("other-book", "ebook")).stale).toBe(false);
    const root = path.join(home, "projects", "other-book");
    const future = new Date(Date.now() + 60_000);
    // .git と node_modules の中、関係ない拡張子は見ない
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "x.typ"), "");
    fs.utimesSync(path.join(root, "node_modules", "x.typ"), future, future);
    fs.writeFileSync(path.join(root, "notes.txt"), "");
    fs.utimesSync(path.join(root, "notes.txt"), future, future);
    expect((await m.statusFor("other-book", "ebook")).stale).toBe(false);
    fs.utimesSync(path.join(root, "main.typ"), future, future);
    expect((await m.statusFor("other-book", "ebook")).stale).toBe(true);
    expect(await hasNewerSources(root, future.getTime() + 1)).toBe(false);
  });

  it("stops the running build on close", async () => {
    const d = new FakeDriver();
    const mm = new BuildManager(host, d, log);
    await mm.request("sample-book", "print");
    await mm.close();
    expect((await mm.statusFor("sample-book", "print")).last).toMatchObject({ ok: false, reason: "stopped" });
  });
});

describe("build HTTP API", () => {
  let home: string;
  let a: App;
  let d: FakeDriver;
  beforeAll(async () => {
    home = makeHome();
    makeProject(home);
    fs.writeFileSync(path.join(home, "projects", "sample-book", "typst-studio.toml"), TOML);
    const host = parseHostConfig({ auth: { mode: "none" } }, { home, dist: home, container: false, where: "config.toml" });
    d = new FakeDriver();
    a = buildApp(host, d);
    await a.app.ready();
  });
  afterAll(async () => {
    await a.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lists profiles with the default", async () => {
    const res = await a.app.inject({ method: "GET", url: "/api/projects/sample-book/profiles" });
    expect(res.json()).toEqual({ profiles: ["print", "ebook"], default: "print" });
    expect((await a.app.inject({ method: "GET", url: "/api/projects/nope/profiles" })).statusCode).toBe(404);
  });

  it("starts a build (202), serves the PDF with Range, and 503s on low memory", async () => {
    const res = await a.app.inject({ method: "POST", url: "/api/projects/sample-book/build", payload: { profile: "print" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ state: "running", profile: "print" });
    d.procs[0].finish("ok");
    await until(() => a.build["busy"] === false);
    const st = (await a.app.inject({ method: "GET", url: "/api/projects/sample-book/build?profile=print" })).json() as BuildStatus;
    expect(st.last?.ok).toBe(true);
    const url = st.last!.pdfUrl!;

    const full = await a.app.inject({ method: "GET", url });
    expect(full.statusCode).toBe(200);
    expect(full.headers).toMatchObject({
      "content-type": "application/pdf",
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=31536000, immutable",
      "content-length": "13",
      "content-disposition": "inline; filename*=UTF-8''main.pdf",
    });
    expect(full.body).toBe("%PDF-1.7 fake");
    const part = await a.app.inject({ method: "GET", url, headers: { range: "bytes=1-3" } });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-range"]).toBe("bytes 1-3/13");
    expect(part.body).toBe("PDF");
    const bad = await a.app.inject({ method: "GET", url, headers: { range: "bytes=99-" } });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers["content-range"]).toBe("bytes */13");
    expect((await a.app.inject({ method: "GET", url: "/api/projects/sample-book/builds/..%2F..%2Fconfig.toml" })).statusCode).toBe(404);
    expect((await a.app.inject({ method: "GET", url: "/api/projects/sample-book/builds/print-000000000000.pdf" })).statusCode).toBe(404);

    d.available = 0;
    const no = await a.app.inject({ method: "POST", url: "/api/projects/sample-book/build", payload: {} });
    expect(no.statusCode).toBe(503);
    expect(no.json()).toMatchObject({ reason: "nomem", available: 0, required: parseSize("1500M") + MEMORY_MARGIN_BYTES });
    d.available = 8 * 1024 ** 3;
  });

  it("stops the preview first when stopPreview is true", async () => {
    let stopped = 0;
    const orig = a.preview.stop.bind(a.preview);
    a.preview.stop = async (r?: string) => {
      stopped++;
      return orig(r);
    };
    d.available = 0;
    const res = await a.app.inject({ method: "POST", url: "/api/projects/sample-book/build", payload: { stopPreview: true } });
    expect(res.statusCode).toBe(503);
    expect(stopped).toBe(1);
    d.available = 8 * 1024 ** 3;
  });
});

// 実際の typst で小さな .typ を 1 回だけビルドする（$TYPST_STUDIO_DIST/bin/typst がある環境だけ）
const REAL_DIST = process.env.TYPST_STUDIO_DIST ?? path.join(process.env.HOME ?? "", ".local", "share", "typst-studio");
describe.skipIf(!fs.existsSync(path.join(REAL_DIST, "bin", "typst")))("real typst compile", () => {
  it("builds a tiny document and reports a warning with a repo-relative path", async () => {
    const home = makeHome();
    try {
      const root = makeProject(home);
      fs.writeFileSync(path.join(root, "typst-studio.toml"), TOML);
      fs.mkdirSync(path.join(root, "chapters"));
      fs.writeFileSync(path.join(root, "main.typ"), '#include "chapters/one.typ"\n');
      fs.writeFileSync(path.join(root, "chapters", "one.typ"), '= One\n#text(font: "NoSuchFont")[x]\n');
      // 小さな文書なので上限も小さく（空きメモリの判定 = memory_max + 300MB を通しやすく）
      const host = parseHostConfig({ auth: { mode: "none" }, build: { memory_max: "200M" } }, { home, dist: REAL_DIST, container: false, where: "config.toml" });
      const m = new BuildManager(host, new NoneDriver(path.join(home, "state")), Fastify({ logger: false }).log);
      await m.request("sample-book", "print");
      await until(() => m["busy"] === false, 60_000);
      const st = await m.statusFor("sample-book", "print");
      expect(st.last).toMatchObject({ ok: true, reason: "ok", warnings: 1 });
      expect(st.last!.diagnostics[0]).toMatchObject({ severity: "warning", file: "chapters/one.typ", line: 2 });
      expect(fs.readFileSync(path.join(home, "builds", "sample-book", `print-${st.last!.buildId}.pdf`)).subarray(0, 5).toString()).toBe("%PDF-");
      await m.close();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }, 60_000);
});
