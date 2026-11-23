import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import WebSocket from "ws";
import { ConfigError, loadProjectConfig, resolveInside, type HostConfig, type ProjectConfig } from "../config.js";
import type { ExitInfo, LimitedProcess, ProcessLimitDriver } from "../limits/driver.js";
import { upstreamOrigin } from "./relay.js";

// tinymist preview（記事）の起動管理。最大 1 本（spec 3.8.1）

export type PreviewState = "stopped" | "starting" | "running" | "stopping";

interface ControlLast {
  kind: string;
  at: string;
  bytes: number;
  text: string; // 先頭 1KB まで
}

interface Running {
  project: string;
  article: string;
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
  ) {}

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

    this.state = "starting";
    this.lastError = undefined;
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
      proc,
      startedAt: new Date().toISOString(),
      controlConnected: false,
      controlCounts: {},
      reachedRunning: false,
    };
    this.cur = run;
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
    this.state = "running";
    run.reachedRunning = true;
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
      });
    });
  }

  private onExit(run: Running, info: ExitInfo): void {
    this.log.info({ unit: run.proc.id, ...info }, "tinymist exited");
    this.lastExit = { ...info, at: new Date().toISOString(), project: run.project, article: run.article };
    run.control?.terminate();
    if (this.cur === run) {
      this.cur = undefined;
      this.state = "stopped";
      this.clearIdleTimer();
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
    this.state = "stopping";
    this.clearIdleTimer();
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
      lastExit: this.lastExit ?? null,
      autoRestartsLeft: this.autoRestartsLeft,
      lastError: this.lastError ?? null,
    };
  }
}
