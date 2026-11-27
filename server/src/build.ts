import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { loadProjectConfig, parseSize, type HostConfig, type ProjectConfig } from "./config.js";
import type { ExitReason, LimitedProcess, ProcessLimitDriver } from "./limits/driver.js";

// 本全体ビルド（spec 3.3.4 / 4.6 / 3.8）。typst compile を同時に 1 本、待ちは最大 1 本。
// どちらも全プロジェクト・全プロファイルを通しての数（メモリのため）

export interface Diagnostic {
  severity: "error" | "warning";
  file: string | null;
  line: number | null;
  column: number | null;
  message: string;
}

export interface BuildResult {
  buildId: string;
  profile: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  ok: boolean;
  reason: ExitReason | "nomem";
  diagnostics: Diagnostic[];
  warnings: number;
  pdfUrl?: string;
  sizeBytes?: number;
}

export interface BuildStatus {
  project: string;
  profile: string;
  state: "idle" | "running" | "queued";
  running?: { buildId: string; startedAt: string };
  last?: BuildResult;
  lastSuccess?: BuildResult;
  stale: boolean;
}

export class BuildError extends Error {
  constructor(
    readonly status: 400 | 503,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ビルド開始前の空きメモリの余裕（spec 3.8.3: build.memory_max + 300MB）
export const MEMORY_MARGIN_BYTES = 300 * 1024 * 1024;
// 出力ファイル名に使うので、プロファイル名はこの形だけ
const PROFILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// <profile>-<buildId>.pdf。buildId は時刻（base36・8 桁）+ 乱数（4 桁）で、文字列の順が作成順
export const BUILD_FILE_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)-([0-9a-z]{12})\.pdf$/;
// 診断を読むために持っておく出力の上限
const MAX_OUTPUT_BYTES = 256 * 1024;
// stale の判定に使う拡張子
const STALE_EXT = new Set([".typ", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".pdf", ".bib", ".yaml", ".yml", ".csv", ".json", ".toml"]);
// stale の計算結果を使い回す時間（ファイル監視の通知でも捨てる）
const STALE_TTL_MS = 5000;

function newBuildId(): string {
  return Date.now().toString(36).padStart(8, "0") + randomBytes(2).toString("hex");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 場所の無い診断（"error: ..."）を先に見る。場所付きの形で読むと "error: a:1:2: ..." の前半をファイル名と誤読する
const DIAG_NOFILE_RE = /^(error|warning|help|hint): (.*)$/;
const DIAG_FILE_RE = /^(.+?):(\d+):(\d+): (error|warning|help|hint): (.*)$/;
// ANSI の色づけ
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

// typst compile --diagnostic-format short の出力を読む。help / hint は直前の診断の message に足す。
// cwd = root で実行するので、パスはリポジトリ相対で出る。リポジトリの外（パッケージなど）は file を null にして message に残す
export function parseDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const line of text.split("\n")) {
    const l = line.replace(ANSI_RE, "").trimEnd();
    const nf = DIAG_NOFILE_RE.exec(l);
    const m: (string | undefined)[] | null = nf ? [l, undefined, undefined, undefined, nf[1], nf[2]] : DIAG_FILE_RE.exec(l);
    if (!m) continue;
    const [, file, ln, col, sev, msg] = m as [string, string | undefined, string, string, string, string];
    if (sev === "help" || sev === "hint") {
      const prev = out.at(-1);
      if (prev) prev.message += `\n${sev}: ${file ? `${file}:${ln}:${col}: ` : ""}${msg}`;
      continue;
    }
    let rel: string | null = null;
    if (file !== undefined) {
      const norm = path.posix.normalize(file);
      if (!path.posix.isAbsolute(norm) && norm !== ".." && !norm.startsWith("../") && !norm.startsWith("@")) rel = norm;
    }
    out.push({
      severity: sev as "error" | "warning",
      file: rel,
      line: rel !== null ? Number(ln) : null,
      column: rel !== null ? Number(col) : null,
      message: file !== undefined && rel === null ? `${file}:${ln}:${col}: ${msg}` : msg,
    });
  }
  return out;
}

// リポジトリ内のソース（.typ・画像・データ）の最新の mtime（ms）。無ければ 0。
// 隠しディレクトリ（.git など）と node_modules には入らない。リンクはたどらない
export async function latestSourceMtime(root: string): Promise<number> {
  let latest = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      ents = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (!e.name.startsWith(".") && e.name !== "node_modules") stack.push(path.join(dir, e.name));
      } else if (e.isFile() && STALE_EXT.has(path.extname(e.name).toLowerCase())) {
        const st = await fs.promises.stat(path.join(dir, e.name)).catch(() => undefined);
        if (st && st.mtimeMs > latest) latest = st.mtimeMs;
      }
    }
  }
  return latest;
}

export type BuildAccepted = "started" | "queued" | "dropped";

interface Job {
  project: string;
  profile: string;
}

interface Running extends Job {
  buildId: string;
  startedAt: string;
  proc?: LimitedProcess;
}

export class BuildManager {
  // 受け付けてから（空きメモリの確認・実行・待ちの処理が）終わるまで true
  private busy = false;
  private running?: Running;
  private queued?: Job;
  private results = new Map<string, { last?: BuildResult; lastSuccess?: BuildResult }>();
  private emitting: Promise<void> = Promise.resolve();
  private idle: Promise<void> = Promise.resolve();
  private closed = false;
  // プロジェクト → ソースの最新 mtime（stale 用のキャッシュ）
  private mtimes = new Map<string, { at: number; value: Promise<number> }>();

  constructor(
    private host: HostConfig,
    private driver: ProcessLimitDriver,
    private log: FastifyBaseLogger,
    private notify: (st: BuildStatus) => void = () => undefined,
  ) {}

  get buildsDir(): string {
    return path.join(this.host.home, "builds");
  }

  // 省略時は book.preview_profile、それも無ければ最初のプロファイル
  static defaultProfile(project: ProjectConfig): string | null {
    return project.book.previewProfile ?? Object.keys(project.profiles)[0] ?? null;
  }

  private resolveProfile(project: ProjectConfig, profile: unknown): string {
    if (profile !== undefined && typeof profile !== "string") throw new BuildError(400, '"profile" must be a string');
    const name = profile ?? BuildManager.defaultProfile(project);
    if (name === null) throw new BuildError(400, `project "${project.name}" has no [profiles.*]`);
    if (!Object.hasOwn(project.profiles, name)) throw new BuildError(400, `profile "${name}" is not defined in [profiles.*]`);
    if (!PROFILE_NAME_RE.test(name)) throw new BuildError(400, `profile "${name}" cannot be used in a file name (use letters, digits, ".", "_", "-")`);
    return name;
  }

  private requiredBytes(): number {
    return parseSize(this.host.build.memoryMax) + MEMORY_MARGIN_BYTES;
  }

  // ビルドを受け付ける。実行中なら待ちに 1 本だけ積む（既に待ちがあれば何もしない = dropped）。
  // 空きメモリが足りなければ BuildError(503)。beforeStart は実際に始めるときだけ、空きメモリの判定の前に呼ぶ
  async request(
    projectName: string,
    profileIn?: unknown,
    beforeStart?: () => Promise<void>,
  ): Promise<{ status: BuildStatus; accepted: BuildAccepted }> {
    const project = loadProjectConfig(this.host, projectName);
    const profile = this.resolveProfile(project, profileIn);
    if (this.closed) throw new BuildError(503, "the server is shutting down");
    if (this.busy) {
      if (this.queued) return { status: await this.status(project.name, profile), accepted: "dropped" };
      this.queued = { project: project.name, profile };
      this.emit(project.name, profile);
      return { status: await this.status(project.name, profile), accepted: "queued" };
    }
    this.busy = true;
    let available: number;
    try {
      await beforeStart?.();
      available = await this.driver.availableMemoryBytes();
    } catch (e) {
      // 判定の間に積まれた待ちを処理する
      this.idle = this.next();
      throw e;
    }
    const required = this.requiredBytes();
    if (available < required) {
      this.idle = this.next();
      throw new BuildError(503, "not enough free memory to start a build", { reason: "nomem", available, required });
    }
    if (this.closed) {
      this.busy = false;
      throw new BuildError(503, "the server is shutting down");
    }
    this.start(project, profile);
    return { status: await this.status(project.name, profile), accepted: "started" };
  }

  private start(project: ProjectConfig, profile: string): void {
    const run: Running = { project: project.name, profile, buildId: newBuildId(), startedAt: new Date().toISOString() };
    this.running = run;
    this.emit(run.project, profile);
    this.idle = this.run(project, run)
      .catch((e: Error) => this.log.error({ err: e.message }, "build failed unexpectedly"))
      .then(() => {
        this.running = undefined;
        this.emit(run.project, profile);
        return this.next();
      });
  }

  // 待ちを 1 本取り出して始める。空きメモリが足りなければ nomem の結果を残す
  private async next(): Promise<void> {
    const job = this.queued;
    this.queued = undefined;
    if (!job || this.closed) {
      this.busy = false;
      return;
    }
    const now = new Date().toISOString();
    const fail = (reason: "nomem" | "error", message: string) => {
      this.record(job.project, {
        buildId: newBuildId(),
        profile: job.profile,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        ok: false,
        reason,
        diagnostics: [{ severity: "error", file: null, line: null, column: null, message }],
        warnings: 0,
      });
      this.busy = false;
      this.emit(job.project, job.profile);
    };
    let project: ProjectConfig;
    try {
      project = loadProjectConfig(this.host, job.project);
      this.resolveProfile(project, job.profile);
    } catch (e) {
      return fail("error", (e as Error).message);
    }
    let available: number;
    try {
      available = await this.driver.availableMemoryBytes();
    } catch (e) {
      return fail("error", (e as Error).message);
    }
    const required = this.requiredBytes();
    if (available < required) {
      return fail("nomem", `not enough free memory to start a build (available ${available} bytes, required ${required} bytes)`);
    }
    if (this.closed) {
      this.busy = false;
      return;
    }
    this.start(project, job.profile);
  }

  private async run(project: ProjectConfig, run: Running): Promise<void> {
    const prof = project.profiles[run.profile];
    const outDir = path.join(this.buildsDir, project.name);
    fs.mkdirSync(outDir, { recursive: true });
    const file = `${run.profile}-${run.buildId}.pdf`;
    const tmp = path.join(outDir, `.${file}.partial`);
    const fontPaths = [...project.fonts.paths.map((p) => path.join(project.root, p)), ...this.host.fonts.extraPaths];
    const args = ["compile", "--root", project.root, "--diagnostic-format", "short", "--format", "pdf"];
    if (fontPaths.length) args.push("--font-path", fontPaths.join(":"));
    if (!project.fonts.system) args.push("--ignore-system-fonts");
    for (const [k, v] of Object.entries(prof.inputs)) args.push("--input", `${k}=${v}`);
    args.push(prof.entry, tmp);

    const t0 = Date.now();
    let output = "";
    let reason: BuildResult["reason"] = "error";
    let detail: string | undefined;
    try {
      const proc = await this.driver.start({
        label: "build",
        command: path.join(this.host.dist, "bin", "typst"),
        args,
        cwd: project.root,
        limits: { memoryMax: this.host.build.memoryMax, swapMax: "0", timeoutSeconds: this.host.build.timeoutSeconds, addressSpace: true },
      });
      run.proc = proc;
      this.log.info({ unit: proc.id, project: project.name, profile: run.profile, buildId: run.buildId, args }, "build started");
      proc.onOutput((_stream, chunk) => {
        if (output.length < MAX_OUTPUT_BYTES) output += chunk.toString("utf8");
      });
      // close() が start の途中で呼ばれたとき
      if (this.closed) void proc.stop();
      const info = await proc.exited;
      reason = info.reason;
      detail = info.detail ?? (info.code !== null ? `typst exited with code ${info.code}` : info.signal ? `typst was killed by ${info.signal}` : undefined);
    } catch (e) {
      detail = (e as Error).message;
    }

    const diagnostics = parseDiagnostics(output);
    let sizeBytes: number | undefined;
    if (reason === "ok") {
      try {
        fs.renameSync(tmp, path.join(outDir, file));
        sizeBytes = fs.statSync(path.join(outDir, file)).size;
      } catch (e) {
        reason = "error";
        detail = `no PDF was written: ${(e as Error).message}`;
      }
    }
    fs.rmSync(tmp, { force: true });
    if (reason !== "ok" && !diagnostics.some((d) => d.severity === "error")) {
      const message = reason === "error" && output.trim() ? output.trim().slice(-2000) : (detail ?? reason);
      diagnostics.push({ severity: "error", file: null, line: null, column: null, message });
    }
    const ok = reason === "ok";
    const result: BuildResult = {
      buildId: run.buildId,
      profile: run.profile,
      startedAt: run.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      ok,
      reason,
      diagnostics,
      warnings: diagnostics.filter((d) => d.severity === "warning").length,
      ...(ok ? { pdfUrl: `/api/projects/${encodeURIComponent(project.name)}/builds/${file}`, sizeBytes } : {}),
    };
    this.log.info({ project: project.name, profile: run.profile, buildId: run.buildId, reason, durationMs: result.durationMs, detail }, "build finished");
    this.record(project.name, result);
    if (ok) this.prune(outDir, run.profile);
  }

  private record(project: string, r: BuildResult): void {
    const key = `${project}\0${r.profile}`;
    const cur = this.results.get(key) ?? {};
    this.results.set(key, { last: r, lastSuccess: r.ok ? r : cur.lastSuccess });
  }

  // プロファイルごとに最新 build.keep_generations 世代だけ残す
  private prune(outDir: string, profile: string): void {
    const re = new RegExp(`^${escapeRe(profile)}-([0-9a-z]{12})\\.pdf$`);
    const files = fs.readdirSync(outDir).filter((f) => re.test(f)).sort().reverse();
    for (const f of files.slice(this.host.build.keepGenerations)) fs.rmSync(path.join(outDir, f), { force: true });
  }

  // 状態の通知。その時点の状態を取り、stale の計算の後に順に送る（前後しないように）
  private emit(project: string, profile: string): void {
    const snap = this.snapshot(project, profile);
    this.emitting = this.emitting
      .then(() => this.withStale(snap))
      .then((st) => this.notify(st))
      .catch((e: Error) => this.log.warn({ err: e.message }, "failed to send build status"));
  }

  private snapshot(project: string, profile: string): BuildStatus {
    const r = this.results.get(`${project}\0${profile}`) ?? {};
    const run = this.running?.project === project && this.running.profile === profile ? this.running : undefined;
    const queued = this.queued?.project === project && this.queued.profile === profile;
    return {
      project,
      profile,
      state: run ? "running" : queued ? "queued" : "idle",
      ...(run ? { running: { buildId: run.buildId, startedAt: run.startedAt } } : {}),
      ...(r.last ? { last: r.last } : {}),
      ...(r.lastSuccess ? { lastSuccess: r.lastSuccess } : {}),
      stale: false,
    };
  }

  private async withStale(st: BuildStatus): Promise<BuildStatus> {
    if (!st.lastSuccess) return st;
    try {
      return { ...st, stale: (await this.latestMtime(st.project)) > Date.parse(st.lastSuccess.startedAt) };
    } catch {
      return st;
    }
  }

  private latestMtime(project: string): Promise<number> {
    const c = this.mtimes.get(project);
    if (c && Date.now() - c.at < STALE_TTL_MS) return c.value;
    const value = Promise.resolve()
      .then(() => latestSourceMtime(loadProjectConfig(this.host, project).root));
    value.catch(() => this.mtimes.delete(project));
    this.mtimes.set(project, { at: Date.now(), value });
    return value;
  }

  // ファイル監視の通知で stale のキャッシュを捨てる
  invalidate(project: string): void {
    this.mtimes.delete(project);
  }

  // 前回の studio が残した書きかけの PDF（.<profile>-<buildId>.pdf.partial）を消す。起動時に 1 回呼ぶ
  cleanupPartials(): string[] {
    const done: string[] = [];
    let projects: string[];
    try {
      projects = fs.readdirSync(this.buildsDir);
    } catch {
      return done;
    }
    for (const p of projects) {
      let files: string[];
      try {
        files = fs.readdirSync(path.join(this.buildsDir, p));
      } catch {
        continue;
      }
      for (const f of files) {
        if (!/^\..+\.pdf\.partial$/.test(f)) continue;
        fs.rmSync(path.join(this.buildsDir, p, f), { force: true });
        done.push(`${p}/${f}`);
      }
    }
    return done;
  }

  status(project: string, profile: string): Promise<BuildStatus> {
    return this.withStale(this.snapshot(project, profile));
  }

  // GET /build 用。profile 省略時は既定のプロファイル
  async statusFor(projectName: string, profileIn?: unknown): Promise<BuildStatus> {
    const project = loadProjectConfig(this.host, projectName);
    return this.status(project.name, this.resolveProfile(project, profileIn));
  }

  // 終了時。待ちを捨て、実行中のビルドを止める
  async close(): Promise<void> {
    this.closed = true;
    this.queued = undefined;
    await this.running?.proc?.stop();
    await this.idle;
    await this.emitting;
  }
}

// Range: bytes=a-b（1 範囲だけ）。範囲外なら "unsatisfiable"、無い・読めない・複数範囲なら null（全体を返す）
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (m[2] !== "" && Number(m[2]) < start) return null;
  }
  if (start >= size) return "unsatisfiable";
  return { start, end };
}
