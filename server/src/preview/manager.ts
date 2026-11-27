import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import WebSocket from "ws";
import { ConfigError, loadProjectConfig, resolveInside, type HostConfig, type ProjectConfig } from "../config.js";
import { checkRelPath, FileError, MAX_FILE_BYTES, readProjectFile, resolveExistingFile } from "../files.js";
import { findImageCallAt, imageCalls, lineStarts, type ImageCall } from "../images.js";
import type { ExitInfo, LimitedProcess, ProcessLimitDriver } from "../limits/driver.js";
import { upstreamOrigin } from "./relay.js";

// tinymist preview（記事）の起動管理。最大 1 本（spec 3.8.1）

export type PreviewState = "stopped" | "starting" | "running" | "stopping";

// 位置（0 始まり）。character は JavaScript の文字列の位置（UTF-16）。
// tinymist の制御プレーンは文字（コードポイント）単位なので、送受信のときに変換する
export interface TextPosition {
  line: number;
  character: number;
}

export type PreviewStatus = ReturnType<PreviewManager["status"]>;

export type PreviewEvent =
  | ({ type: "preview-status" } & PreviewStatus)
  | { type: "preview-jump"; project: string; path: string; start: TextPosition; end: TextPosition; image?: ImageCall }
  | { type: "preview-compile"; project: string; ok: boolean; message?: string };

// updateMemoryFiles で持っておく内容の合計の上限
export const MAX_MEMORY_BYTES = 16 * 1024 * 1024;

// 制御の API のエラー（プレビュー停止中・別プロジェクト・制御接続なし）
export class PreviewError extends Error {
  constructor(
    readonly status: 409,
    message: string,
  ) {
    super(message);
  }
}

interface ControlLast {
  kind: string;
  at: string;
  bytes: number;
  text: string; // 先頭 1KB まで
}

interface Running {
  project: string;
  article: string;
  root: string;
  // updateMemoryFiles で渡した内容（リポジトリ相対のパス → 内容）。位置の変換と image( の照合に使う
  memory: Map<string, string>;
  // 最後に届いたコンパイル結果（compileStatus）
  compile?: { ok: boolean; at: string };
  proc: LimitedProcess;
  startedAt: string;
  control?: WebSocket;
  controlConnected: boolean;
  controlCounts: Record<string, number>;
  controlLast?: ControlLast;
  // 起動が完了した（running に達した）か。自動再起動はこれが true の run だけ
  reachedRunning: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForPort(port: number, timeoutMs: number, aborted: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (aborted()) return reject(new Error("tinymist exited before listening"));
      const s = net.connect({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.destroy();
        resolve();
      });
      s.once("error", () => {
        s.destroy();
        if (Date.now() > deadline) reject(new Error(`127.0.0.1:${port} did not open within ${timeoutMs}ms`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

// 記事のパスを検証する。リポジトリ相対・articles.glob に一致・実在
export function checkArticle(project: ProjectConfig, article: string): string {
  const norm = path.posix.normalize(article);
  if (norm !== article) throw new ConfigError(`article "${article}" must be a normalized relative path`);
  if (!path.matchesGlob(article, project.articles.glob)) {
    throw new ConfigError(`article "${article}" does not match articles.glob "${project.articles.glob}"`);
  }
  const abs = resolveInside(project.root, article, "article");
  if (!fs.statSync(abs).isFile()) throw new ConfigError(`article "${article}" is not a file`);
  return article;
}

export function previewInputs(project: ProjectConfig, article: string): Record<string, string> {
  const inputs: Record<string, string> = {};
  const fill = (src: Record<string, string>) => {
    for (const [k, v] of Object.entries(src)) inputs[k] = v.replaceAll("{article_entry}", article);
  };
  fill(project.preview.inputs);
  for (const o of project.articles.override) if (path.matchesGlob(article, o.match)) fill(o.inputs);
  return inputs;
}

export class PreviewManager {
  private state: PreviewState = "stopped";
  private cur?: Running;
  private viewers = new Set<Duplex>();
  private idleTimer?: NodeJS.Timeout;
  private lastExit?: ExitInfo & { at: string; project: string; article: string };
  private lastError?: string;
  private queue: Promise<unknown> = Promise.resolve();
  // 上限で止まったときの自動再起動は 1 回まで（spec 3.8.1）。start のたびに戻す
  private autoRestartsLeft = 0;

  constructor(
    private host: HostConfig,
    private driver: ProcessLimitDriver,
    private log: FastifyBaseLogger,
    private notify: (ev: PreviewEvent) => void = () => undefined,
  ) {}

  private setState(s: PreviewState): void {
    if (this.state === s) return;
    this.state = s;
    this.emitStatus();
  }

  private emitStatus(): void {
    this.notify({ type: "preview-status", ...this.status() });
  }

  get dataPlanePort(): number {
    return this.host.preview.dataPlanePort;
  }

  isRunning(): boolean {
    return this.state === "running";
  }

  // start / stop は順に実行する
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  start(projectName: string, article: string): Promise<void> {
    return this.serial(async () => {
      if (this.cur) await this.stopInner("restart");
      const project = loadProjectConfig(this.host, projectName);
      checkArticle(project, article);
      this.autoRestartsLeft = 1;
      await this.launch(project, article);
    });
  }

  stop(reason = "api"): Promise<void> {
    return this.serial(() => this.stopInner(reason));
  }

  private async launch(project: ProjectConfig, article: string): Promise<void> {
    const pv = this.host.preview;
    for (const port of [pv.dataPlanePort, pv.controlPlanePort]) {
      if (await portInUse(port)) throw new Error(`127.0.0.1:${port} is already in use`);
    }
    const fontPaths = [...project.fonts.paths.map((p) => path.join(project.root, p)), ...this.host.fonts.extraPaths];
    const args = [
      "preview",
      "--no-open",
      "--data-plane-host",
      `127.0.0.1:${pv.dataPlanePort}`,
      "--control-plane-host",
      `127.0.0.1:${pv.controlPlanePort}`,
      "--root",
      project.root,
      "--font-path",
      fontPaths.join(":"),
    ];
    if (!project.fonts.system) args.push("--ignore-system-fonts");
    for (const [k, v] of Object.entries(previewInputs(project, article))) args.push("--input", `${k}=${v}`);
    args.push(project.preview.entry);

    this.lastError = undefined;
    this.setState("starting");
    const proc = await this.driver.start({
      label: "preview",
      command: path.join(this.host.dist, "bin", "tinymist"),
      args,
      cwd: project.root,
      limits: { memoryMax: pv.memoryMax, swapMax: "0", cpuQuota: pv.cpuQuota, nice: 10 },
    });
    this.log.info({ unit: proc.id, project: project.name, article, args }, "tinymist started");
    proc.onOutput((stream, chunk) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (line.trim()) this.log.info({ stream }, `[tinymist] ${line}`);
      }
    });

    const run: Running = {
      project: project.name,
      article,
      root: project.root,
      memory: new Map(),
      proc,
      startedAt: new Date().toISOString(),
      controlConnected: false,
      controlCounts: {},
      reachedRunning: false,
    };
    this.cur = run;
    // starting の通知にプロジェクトと記事を載せる
    this.emitStatus();
    let exited = false;
    void proc.exited.then((info) => {
      exited = true;
      this.onExit(run, info);
    });

    try {
      await waitForPort(pv.dataPlanePort, 15000, () => exited);
      await waitForPort(pv.controlPlanePort, 15000, () => exited);
      await this.connectControl(run);
    } catch (e) {
      this.lastError = (e as Error).message;
      await proc.stop();
      throw e;
    }
    run.reachedRunning = true;
    this.setState("running");
    this.scheduleIdleStop();
  }

  // コントロールプレーンへの接続を 1 本だけ張り、tinymist の寿命中ずっと保持する
  private connectControl(run: Running): Promise<void> {
    const port = this.host.preview.controlPlanePort;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { origin: upstreamOrigin(port) });
      run.control = ws;
      ws.once("open", () => {
        run.controlConnected = true;
        this.log.info({ port }, "control plane connected");
        resolve();
      });
      ws.once("error", (e) => {
        if (!run.controlConnected) reject(e);
        else this.log.warn({ err: e.message }, "control plane error");
      });
      ws.on("close", (code) => {
        run.controlConnected = false;
        this.log.info({ code }, "control plane closed");
      });
      ws.on("message", (data, isBinary) => {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        let kind = isBinary ? "binary" : "text";
        const text = isBinary ? "" : buf.toString("utf8");
        if (!isBinary) {
          try {
            const msg = JSON.parse(text) as { event?: unknown; type?: unknown };
            const k = msg.event ?? msg.type;
            if (typeof k === "string") kind = k;
          } catch {
            // JSON でなければ text のまま
          }
        }
        run.controlCounts[kind] = (run.controlCounts[kind] ?? 0) + 1;
        run.controlLast = { kind, at: new Date().toISOString(), bytes: buf.length, text: text.slice(0, 1024) };
        this.log.info({ kind, count: run.controlCounts[kind], bytes: buf.length }, "control message");
        if (kind === "editorScrollTo" || kind === "compileStatus") {
          try {
            this.onControlMessage(run, kind, JSON.parse(text) as Record<string, unknown>);
          } catch (e) {
            this.log.warn({ kind, err: (e as Error).message }, "failed to handle a control message");
          }
        }
      });
    });
  }

  private onExit(run: Running, info: ExitInfo): void {
    this.log.info({ unit: run.proc.id, ...info }, "tinymist exited");
    this.lastExit = { ...info, at: new Date().toISOString(), project: run.project, article: run.article };
    run.control?.terminate();
    if (this.cur === run) {
      this.cur = undefined;
      this.clearIdleTimer();
      this.setState("stopped");
      for (const v of this.viewers) v.destroy();
      this.viewers.clear();
      // 起動途中に止まったときは start が失敗を返すので、再起動しない
      if (info.reason === "limit" && run.reachedRunning && this.autoRestartsLeft > 0) {
        this.autoRestartsLeft--;
        this.log.warn({ project: run.project, article: run.article }, "tinymist hit the memory limit; restarting once");
        void this.serial(async () => {
          if (this.cur) return;
          await this.launch(loadProjectConfig(this.host, run.project), run.article);
        }).catch((e: Error) => this.log.error({ err: e.message }, "auto restart failed"));
      }
    }
  }

  private async stopInner(reason: string): Promise<void> {
    const run = this.cur;
    if (!run) return;
    this.clearIdleTimer();
    this.setState("stopping");
    this.log.info({ reason, unit: run.proc.id }, "stopping tinymist");
    // 制御接続は切らずに、ドライバの停止を呼ぶ（spec 3.3.3）
    await run.proc.stop();
    // onExit は exited の then で走る。念のため待つ
    for (let i = 0; i < 20 && this.cur === run; i++) await sleep(50);
  }

  // データプレーンの中継接続（= 閲覧者）
  viewerOpened(s: Duplex): void {
    this.viewers.add(s);
    this.clearIdleTimer();
    this.log.info({ viewers: this.viewers.size }, "viewer connected");
  }

  viewerClosed(s: Duplex): void {
    if (!this.viewers.delete(s)) return;
    this.log.info({ viewers: this.viewers.size }, "viewer disconnected");
    if (this.viewers.size === 0) this.scheduleIdleStop();
  }

  private scheduleIdleStop(): void {
    this.clearIdleTimer();
    if (this.state !== "running") return;
    const ms = this.host.preview.idleStopMinutes * 60_000;
    this.idleTimer = setTimeout(() => void this.stop("idle"), ms);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // tinymist → studio（editorScrollTo / compileStatus。形は tinymist 0.14.18 の typst-preview の ControlPlaneResponse）
  private onControlMessage(run: Running, kind: string, msg: Record<string, unknown>): void {
    if (this.cur !== run) return;
    if (kind === "compileStatus") {
      // { event: "compileStatus", kind: "Compiling" | "CompileSuccess" | "CompileError" }。エラーの内容は届かない
      if (msg.kind !== "CompileSuccess" && msg.kind !== "CompileError") return;
      const ok = msg.kind === "CompileSuccess";
      const changed = run.compile?.ok !== ok;
      run.compile = { ok, at: new Date().toISOString() };
      this.notify({ type: "preview-compile", project: run.project, ok });
      if (changed) this.emitStatus();
      return;
    }
    // { event: "editorScrollTo", filepath: 絶対パス, start: [行, 文字] | null, end: [行, 文字] | null }（0 始まり）
    const { filepath, start, end } = msg;
    if (typeof filepath !== "string" || !isPair(start)) return;
    const r = path.relative(run.root, filepath);
    if (r === "" || r === ".." || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) {
      this.log.info({ filepath }, "editorScrollTo outside the project; ignored");
      return;
    }
    const rel = r.split(path.sep).join("/");
    const text = this.textOf(run, rel);
    const s = fromCodePoints(text, start);
    const e = isPair(end) ? fromCodePoints(text, end) : s;
    const ev: PreviewEvent = { type: "preview-jump", project: run.project, path: rel, start: s, end: e };
    if (text !== undefined && rel.endsWith(".typ")) {
      try {
        const image = findImageCallAt(text, imageCalls(text, rel), offsetOf(text, s));
        if (image) ev.image = image;
      } catch (err) {
        // 深すぎる入れ子など。位置だけ送る
        this.log.info({ path: rel, err: (err as Error).message }, "could not match image() calls");
      }
    }
    this.notify(ev);
  }

  // 位置の変換に使う内容。メモリファイルがあればそれ、無ければディスク
  private textOf(run: Running, rel: string): string | undefined {
    const m = run.memory.get(rel);
    if (m !== undefined) return m;
    try {
      return readProjectFile(run.root, rel).content;
    } catch {
      return undefined;
    }
  }

  // 制御の API の対象。プレビューが動いていて、同じプロジェクトであること
  private controlTarget(project: unknown, rel: unknown): { run: Running; rel: string; abs: string } {
    if (typeof project !== "string") throw new ConfigError('"project" (string) is required');
    const p = checkRelPath(rel);
    const run = this.cur;
    if (this.state !== "running" || !run) throw new PreviewError(409, "preview is not running");
    if (run.project !== project) throw new PreviewError(409, `preview is running for project "${run.project}"`);
    if (!run.control || run.control.readyState !== WebSocket.OPEN) throw new PreviewError(409, "control plane is not connected");
    return { run, rel: p, abs: path.join(run.root, p) };
  }

  private sendControl(run: Running, msg: Record<string, unknown>): void {
    run.control!.send(JSON.stringify(msg));
  }

  // 未保存の内容を tinymist に渡す（updateMemoryFiles）
  // 受け付けるのはリポジトリ内に実在する .typ だけ。持っておく内容は合計 MAX_MEMORY_BYTES まで
  updateMemory(project: unknown, rel: unknown, content: unknown): void {
    if (typeof content !== "string") throw new ConfigError('"content" (string) is required');
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_FILE_BYTES) throw new FileError(413, `content is larger than ${MAX_FILE_BYTES} bytes`);
    const t = this.controlTarget(project, rel);
    if (!t.rel.endsWith(".typ")) throw new FileError(400, `"${t.rel}" is not a .typ file`);
    resolveExistingFile(t.run.root, t.rel);
    let total = bytes;
    for (const [k, v] of t.run.memory) if (k !== t.rel) total += Buffer.byteLength(v);
    if (total > MAX_MEMORY_BYTES) {
      throw new FileError(413, `unsaved buffers would exceed ${MAX_MEMORY_BYTES} bytes in total; save or reset some files first`);
    }
    this.sendControl(t.run, { event: "updateMemoryFiles", files: { [t.abs]: content } });
    t.run.memory.set(t.rel, content);
  }

  // ディスクの内容に戻す（removeMemoryFiles）
  resetMemory(project: unknown, rel: unknown): void {
    const t = this.controlTarget(project, rel);
    this.sendControl(t.run, { event: "removeMemoryFiles", files: [t.abs] });
    t.run.memory.delete(t.rel);
  }

  // ソースの位置へプレビューをスクロールする（panelScrollTo）
  scrollTo(project: unknown, rel: unknown, line: unknown, character: unknown): void {
    const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
    if (!isIndex(line) || !isIndex(character)) throw new ConfigError('"line" and "character" (integers >= 0) are required');
    const t = this.controlTarget(project, rel);
    const text = this.textOf(t.run, t.rel);
    this.sendControl(t.run, { event: "panelScrollTo", filepath: t.abs, line, character: toCodePoints(text, line, character) });
  }

  status() {
    const r = this.cur;
    return {
      state: this.state,
      driver: { name: this.driver.name, capability: this.driver.capability },
      project: r?.project ?? null,
      article: r?.article ?? null,
      unit: r?.proc.id ?? null,
      startedAt: r?.startedAt ?? null,
      viewers: this.viewers.size,
      idleStopMinutes: this.host.preview.idleStopMinutes,
      control: r
        ? { connected: r.controlConnected, counts: r.controlCounts, last: r.controlLast ?? null }
        : null,
      compile: r?.compile ?? null,
      lastExit: this.lastExit ?? null,
      autoRestartsLeft: this.autoRestartsLeft,
      lastError: this.lastError ?? null,
    };
  }
}

function isPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isInteger(x) && x >= 0);
}

function lineText(text: string, line: number): string {
  const starts = lineStarts(text);
  if (line >= starts.length) return "";
  // 行末の改行（\r\n は 2 文字）は含めない
  return text.slice(starts[line], line + 1 < starts.length ? starts[line + 1] : undefined).replace(/(?:\r\n|[\n\x0B\x0C\r\u0085\u2028\u2029])$/, "");
}

// [行, 文字（コードポイント）] → 行と UTF-16 の位置。内容が読めなければそのまま
function fromCodePoints(text: string | undefined, [line, col]: [number, number]): TextPosition {
  if (text === undefined) return { line, character: col };
  const chars = [...lineText(text, line)];
  return { line, character: chars.slice(0, col).join("").length + Math.max(0, col - chars.length) };
}

// UTF-16 の位置 → 文字（コードポイント）の数
function toCodePoints(text: string | undefined, line: number, character: number): number {
  if (text === undefined) return character;
  const lt = lineText(text, line);
  return [...lt.slice(0, character)].length + Math.max(0, character - lt.length);
}

function offsetOf(text: string, pos: TextPosition): number {
  const starts = lineStarts(text);
  if (pos.line >= starts.length) return text.length;
  return Math.min(starts[pos.line] + pos.character, text.length);
}
