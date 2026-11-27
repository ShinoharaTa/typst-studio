import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { FastifyBaseLogger } from "fastify";
import type WebSocket from "ws";
import { loadProjectConfig, PROJECT_NAME_RE, type HostConfig } from "./config.js";
import { listArticles, sha256File, TMP_FILE_RE } from "./files.js";
import type { BuildStatus } from "./build.js";
import { gitDir, GitError, readGitStatus, type GitInfo } from "./git.js";
import type { PreviewEvent } from "./preview/manager.js";

// プロジェクトのファイル監視と /api/ws への通知（spec 5.3 / 6.4 / 6.5）

export type StudioEvent =
  | { type: "file-changed"; project: string; path: string; rev: string }
  | { type: "file-removed"; project: string; path: string }
  | ({ type: "git-changed"; project: string } & GitState)
  | { type: "articles-changed"; project: string }
  | { type: "config-changed"; project: string; error?: string }
  | ({ type: "build-status" } & BuildStatus)
  | PreviewEvent;

// GitInfo の各項目。読めなければ null と gitError
export type GitState = { [K in keyof GitInfo]: GitInfo[K] | null } & { gitError?: string };

export const EMPTY_GIT: GitState = { branch: null, detached: null, head: null, uncommitted: null, unpushed: null, upstream: null };

export async function gitState(root: string): Promise<GitState> {
  try {
    return await readGitStatus(root);
  } catch (e) {
    return { ...EMPTY_GIT, gitError: e instanceof GitError ? e.message : (e as Error).message };
  }
}

const DEBOUNCE_MS = 200;
// 変更が続いても、この時間で一度は送る
const MAX_WAIT_MS = 1000;

// .git の中で Git 状態の再取得のきっかけにするもの
function isGitTrigger(rel: string): boolean {
  return rel === "HEAD" || rel === "index" || rel === "packed-refs" || rel === "refs" || rel.startsWith("refs/");
}

function within(dir: string, p: string): string | undefined {
  const r = path.relative(dir, p);
  if (r === "") return "";
  if (r.startsWith("..") || path.isAbsolute(r)) return undefined;
  return r.split(path.sep).join("/");
}

class ProjectWatch {
  private watcher?: FSWatcher;
  private gitDirPath: string;
  // 最後に送った（または読み込みで返した）rev。変わったものだけ送る
  private revs = new Map<string, string>();
  private pending = new Map<string, "change" | "unlink">();
  private structural = false;
  private gitDirty = false;
  private configDirty = false;
  private timer?: NodeJS.Timeout;
  private firstPendingAt = 0;
  private flushing: Promise<void> = Promise.resolve();
  private articles?: string;
  private lastGit?: string;
  private closed = false;

  constructor(
    readonly name: string,
    readonly root: string,
    private hub: Watchers,
  ) {
    this.gitDirPath = path.join(root, ".git");
  }

  async start(): Promise<void> {
    try {
      this.gitDirPath = await gitDir(this.root);
    } catch {
      // git でなくても（所有者不一致でも）ファイルの監視は行う
    }
    this.articles = await this.articleKey();
    this.lastGit = JSON.stringify(await gitState(this.root));

    const paths = [this.root];
    if (within(this.root, this.gitDirPath) === undefined) paths.push(this.gitDirPath);
    const w = chokidar.watch(paths, {
      ignoreInitial: true,
      followSymlinks: false,
      ignorePermissionErrors: true,
      ignored: (p: string) => this.classify(p) === "ignore",
    });
    this.watcher = w;
    w.on("all", (ev, p) => this.onEvent(ev, p));
    w.on("error", (e) => this.hub.log.warn({ project: this.name, err: (e as Error).message }, "watch error"));
    await new Promise<void>((r) => w.once("ready", () => r()));
  }

  private classify(p: string): "work" | "gitmeta" | "dir" | "ignore" {
    const g = within(this.gitDirPath, p);
    if (g !== undefined) return g === "" ? "dir" : isGitTrigger(g) ? "gitmeta" : "ignore";
    const rel = within(this.root, p);
    if (rel === undefined) return "ignore";
    if (rel === "") return "dir";
    const segs = rel.split("/");
    if (segs.some((s) => s === "node_modules" || s.toLowerCase() === ".git")) return "ignore";
    if (TMP_FILE_RE.test(rel)) return "ignore";
    return "work";
  }

  private onEvent(ev: string, p: string): void {
    const kind = this.classify(p);
    if (kind === "gitmeta") this.gitDirty = true;
    else if (kind === "work") {
      const rel = within(this.root, p)!;
      if (ev === "add" || ev === "change") this.pending.set(rel, "change");
      else if (ev === "unlink") this.pending.set(rel, "unlink");
      if (ev !== "change") this.structural = true;
      if (rel === "typst-studio.toml") this.configDirty = true;
      this.gitDirty = true;
    } else return;
    this.schedule();
  }

  markConfigDirty(): void {
    this.configDirty = true;
    this.structural = true;
    this.schedule();
  }

  // 監視が最後に読んだ Git 状態（/api/projects 用）
  currentGit(): GitState {
    return JSON.parse(this.lastGit ?? JSON.stringify(EMPTY_GIT)) as GitState;
  }

  private schedule(): void {
    if (this.closed) return;
    const now = Date.now();
    if (!this.timer) this.firstPendingAt = now;
    else clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, this.firstPendingAt + MAX_WAIT_MS - now));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flushing = this.flushing.then(() => this.flush()).catch((e: Error) => this.hub.log.error({ project: this.name, err: e.message }, "watch flush failed"));
    }, wait);
  }

  private async flush(): Promise<void> {
    const pending = this.pending;
    this.pending = new Map();
    const structural = this.structural;
    const gitDirty = this.gitDirty;
    const configDirty = this.configDirty;
    this.structural = this.gitDirty = this.configDirty = false;

    for (const [rel] of pending) {
      if (this.closed) return;
      const rev = await hashFile(path.join(this.root, rel));
      if (rev === undefined) {
        if (!fs.existsSync(path.join(this.root, rel)) && (this.revs.delete(rel) || pending.get(rel) === "unlink")) {
          this.hub.broadcast({ type: "file-removed", project: this.name, path: rel });
        }
        continue;
      }
      if (this.revs.get(rel) === rev) continue;
      this.revs.set(rel, rev);
      this.hub.broadcast({ type: "file-changed", project: this.name, path: rel, rev });
    }

    if (configDirty) {
      let error: string | undefined;
      try {
        loadProjectConfig(this.hub.host, this.name);
      } catch (e) {
        error = (e as Error).message;
      }
      this.hub.broadcast(error === undefined ? { type: "config-changed", project: this.name } : { type: "config-changed", project: this.name, error });
    }

    if (structural || configDirty) {
      const key = await this.articleKey();
      if (key !== this.articles) {
        this.articles = key;
        this.hub.broadcast({ type: "articles-changed", project: this.name });
      }
    }

    if (gitDirty) {
      const g = await gitState(this.root);
      const key = JSON.stringify(g);
      if (key !== this.lastGit) {
        this.lastGit = key;
        this.hub.broadcast({ type: "git-changed", project: this.name, ...g });
      }
    }
  }

  // 記事一覧の比較用。設定が読めなければ空
  private async articleKey(): Promise<string> {
    try {
      const list = await listArticles(loadProjectConfig(this.hub.host, this.name));
      return list.map((a) => a.path).join("\n");
    } catch {
      return "";
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    await this.flushing;
  }
}

async function hashFile(abs: string): Promise<string | undefined> {
  try {
    // シンボリックリンクはたどらない（指す先のファイルの変更として、そちらのパスで通知される）
    const st = await fs.promises.lstat(abs);
    if (!st.isFile()) return undefined;
    return await sha256File(abs);
  } catch {
    return undefined;
  }
}

export interface WatchersOptions {
  // この間隔で ping し、次の ping までに pong が無ければ切る
  pingIntervalMs?: number;
  // 同時接続数の上限
  maxClients?: number;
  // 送りきれずに溜まった量がこれを超えたクライアントは切る（読まないクライアントでメモリを食わない）
  maxBufferedBytes?: number;
}

type ClientSocket = Pick<WebSocket, "on" | "send" | "ping" | "terminate" | "readyState" | "bufferedAmount" | "OPEN">;

export class Watchers {
  private clients = new Map<ClientSocket, { alive: boolean }>();
  private projects = new Map<string, Promise<ProjectWatch>>();
  private overrides?: FSWatcher;
  private pinger?: NodeJS.Timeout;
  private closed = false;
  readonly opts: Required<WatchersOptions>;

  constructor(
    readonly host: HostConfig,
    readonly log: FastifyBaseLogger,
    opts: WatchersOptions = {},
  ) {
    this.opts = { pingIntervalMs: 30_000, maxClients: 16, maxBufferedBytes: 4 * 1024 * 1024, ...opts };
  }

  canAccept(): boolean {
    return !this.closed && this.clients.size < this.opts.maxClients;
  }

  addClient(ws: ClientSocket): void {
    const st = { alive: true };
    this.clients.set(ws, st);
    ws.on("close", () => this.dropClient(ws));
    ws.on("error", () => this.dropClient(ws));
    ws.on("pong", () => (st.alive = true));
    // クライアントからは "ping" だけ受ける（ブラウザは ping フレームを送れないので、半開きの検出に使う）
    ws.on("message", (m: unknown) => {
      if (String(m) === "ping" && ws.readyState === ws.OPEN) ws.send('{"type":"pong"}');
    });
    if (!this.pinger) {
      this.pinger = setInterval(() => this.pingAll(), this.opts.pingIntervalMs);
      this.pinger.unref();
    }
  }

  private dropClient(ws: ClientSocket): void {
    this.clients.delete(ws);
    if (this.clients.size === 0 && this.pinger) {
      clearInterval(this.pinger);
      this.pinger = undefined;
    }
  }

  private pingAll(): void {
    for (const [ws, st] of this.clients) {
      if (!st.alive) {
        ws.terminate();
        this.dropClient(ws);
        continue;
      }
      st.alive = false;
      ws.ping();
    }
  }

  broadcast(ev: StudioEvent): void {
    const msg = JSON.stringify(ev);
    for (const ws of [...this.clients.keys()]) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > this.opts.maxBufferedBytes) {
        this.log.warn("closing a /api/ws client that does not read its messages");
        ws.terminate();
        this.dropClient(ws);
        continue;
      }
      ws.send(msg);
    }
  }

  // 接続中の /api/ws を切る。server.close() の前に呼ぶ（upgrade 済みのソケットが残ると close が終わらない）
  closeClients(): void {
    for (const ws of this.clients.keys()) ws.terminate();
    this.clients.clear();
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = undefined;
  }

  // $TYPST_STUDIO_HOME/projects/ のディレクトリ名
  listProjectNames(): string[] {
    const dir = path.join(this.host.home, "projects");
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return ents
      .filter((e) => PROJECT_NAME_RE.test(e.name) && fs.statSync(path.join(dir, e.name), { throwIfNoEntry: false })?.isDirectory())
      .map((e) => e.name)
      .sort();
  }

  // 監視を始める（済みなら何もしない）
  ensure(name: string, root: string): Promise<ProjectWatch> {
    if (this.closed) return Promise.reject(new Error("watchers are closed"));
    let p = this.projects.get(name);
    if (!p) {
      const pw = new ProjectWatch(name, root, this);
      p = pw.start().then(() => pw);
      p.catch((e: Error) => {
        this.log.warn({ project: name, err: e.message }, "failed to watch project");
        this.projects.delete(name);
      });
      this.projects.set(name, p);
    }
    return p;
  }

  async startAll(): Promise<void> {
    if (this.closed) return;
    const dir = path.join(this.host.home, "project-overrides");
    if (!this.overrides && fs.existsSync(dir)) {
      // 仮の置き場の設定（project-overrides/<name>.toml）の変化
      this.overrides = chokidar.watch(dir, { ignoreInitial: true, depth: 0 });
      this.overrides.on("all", (_ev, p) => {
        const m = /^(.+)\.toml$/.exec(path.basename(p));
        if (m) void this.projects.get(m[1])?.then((pw) => pw.markConfigDirty(), () => undefined);
      });
      await new Promise<void>((r) => this.overrides!.once("ready", () => r()));
    }
    await Promise.allSettled(
      this.listProjectNames().map(async (n) => this.ensure(n, fs.realpathSync(path.join(this.host.home, "projects", n)))),
    );
  }

  async close(): Promise<void> {
    this.closed = true;
    this.closeClients();
    await this.overrides?.close();
    const all = [...this.projects.values()];
    this.projects.clear();
    await Promise.allSettled(all.map((p) => p.then((pw) => pw.close())));
  }
}
