import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { parseSize } from "../config.js";
import { oomKillCount } from "./cgroup.js";
import type { ExitInfo, ExitReason, LaunchSpec, LimitedProcess } from "./driver.js";

// 子プロセスを自分で起動する（watchdog / none ドライバ共通）。
// 子は新しいプロセスグループにし、停止・上限超過・タイムアウトはグループごと止める

export interface LocalOptions {
  // watchdog: RSS を intervalMs 間隔で見張る。none: 何も制限しない
  mode: { kind: "watchdog"; intervalMs: number } | { kind: "none" };
  // 起動中の子を記録する場所。studio が異常終了しても次の起動で片付けられるように（cleanupLocalChildren）
  stateDir: string;
}

// 上限で殺されやすくする（studio 本体より先に OOM killer の対象にする）
const OOM_SCORE_ADJ = 1000;
const STOP_GRACE_MS = 5000;

async function rssBytes(pid: number): Promise<number> {
  let total = 0;
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop()!;
    try {
      const status = await fs.readFile(`/proc/${p}/status`, "utf8");
      const m = /^VmRSS:\s+(\d+) kB$/m.exec(status);
      if (m) total += Number(m[1]) * 1024;
      for (const tid of await fs.readdir(`/proc/${p}/task`)) {
        const children = await fs.readFile(`/proc/${p}/task/${tid}/children`, "utf8").catch(() => "");
        for (const c of children.split(" ")) if (c.trim()) stack.push(Number(c));
      }
    } catch {
      // 終了済み
    }
  }
  return total;
}

// /proc/<pid>/stat の starttime（pid の再利用と区別するため）
function startTime(pid: number): string | undefined {
  try {
    const stat = fsSync.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

// 前回の studio が残した子（プロセスグループ）を止める。止めたものの説明を返す
export function cleanupLocalChildren(stateDir: string): string[] {
  const done: string[] = [];
  let files: string[];
  try {
    files = fsSync.readdirSync(stateDir).filter((f) => f.endsWith(".json"));
  } catch {
    return done;
  }
  for (const f of files) {
    const file = path.join(stateDir, f);
    try {
      const rec = JSON.parse(fsSync.readFileSync(file, "utf8")) as { pid: number; startTime: string; label: string };
      if (startTime(rec.pid) === rec.startTime) {
        killGroup(rec.pid, "SIGKILL");
        done.push(`${rec.label} (pid ${rec.pid})`);
      }
    } catch {
      // 壊れた記録は捨てる
    }
    fsSync.rmSync(file, { force: true });
  }
  return done;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function streamClosed(s: Readable): Promise<void> {
  return s.closed || s.destroyed ? Promise.resolve() : new Promise((r) => s.once("close", () => r()));
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // 既に居ない
  }
}

export async function startLocal(spec: LaunchSpec, opts: LocalOptions): Promise<LimitedProcess> {
  const l = spec.limits;
  const watchdog = opts.mode.kind === "watchdog";
  const maxBytes = parseSize(l.memoryMax);
  let argv = [spec.command, ...spec.args];
  // typst（musl 静的）は仮想メモリ ≒ RSS なので、アドレス空間の上限も掛ける（spec 3.8.2）
  if (watchdog && l.addressSpace) argv = ["prlimit", `--as=${maxBytes}`, "--", ...argv];
  if (watchdog && l.nice !== undefined) argv = ["nice", "-n", String(l.nice), ...argv];
  const oomBefore = watchdog ? await oomKillCount() : undefined;

  const child = spawn(argv[0], argv.slice(1), {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const pid = child.pid;
  let recordFile: string | undefined;
  if (pid !== undefined) {
    const st = startTime(pid);
    if (st !== undefined) {
      fsSync.mkdirSync(opts.stateDir, { recursive: true });
      recordFile = path.join(opts.stateDir, `${pid}.json`);
      fsSync.writeFileSync(recordFile, JSON.stringify({ pid, startTime: st, label: spec.label }));
    }
  }

  let stopRequested = false;
  let timedOut = false;
  let overLimit: string | undefined;
  let done = false;
  const outputCbs: ((s: "stdout" | "stderr", c: Buffer) => void)[] = [];
  child.stdout.on("data", (c: Buffer) => outputCbs.forEach((cb) => cb("stdout", c)));
  // 上限での abort かを見分けるため、stderr の末尾を持っておく
  let stderrTail = "";
  child.stderr.on("data", (c: Buffer) => {
    stderrTail = (stderrTail + c.toString("utf8")).slice(-4096);
    outputCbs.forEach((cb) => cb("stderr", c));
  });

  let pollTimer: NodeJS.Timeout | undefined;
  if (opts.mode.kind === "watchdog" && pid !== undefined) {
    const interval = opts.mode.intervalMs;
    const poll = async () => {
      if (done) return;
      const rss = await rssBytes(pid);
      if (rss > maxBytes && !done && !stopRequested) {
        overLimit = `watchdog: RSS ${Math.round(rss / 1048576)}MB > ${l.memoryMax}`;
        killGroup(pid, "SIGKILL");
        return;
      }
      if (!done) pollTimer = setTimeout(() => void poll(), interval);
    };
    pollTimer = setTimeout(() => void poll(), interval);
  }

  const timer =
    l.timeoutSeconds !== undefined && pid !== undefined
      ? setTimeout(() => {
          timedOut = true;
          killGroup(pid, "SIGKILL");
        }, l.timeoutSeconds * 1000)
      : undefined;

  const exited = new Promise<ExitInfo>((resolve) => {
    const finish = async (code: number | null, signal: string | null, spawnError?: Error) => {
      if (done) return;
      done = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (timer) clearTimeout(timer);
      // グループに残ったプロセスも片付ける
      if (pid !== undefined) killGroup(pid, "SIGKILL");
      if (recordFile) fsSync.rmSync(recordFile, { force: true });
      // 末尾の出力（診断など）を取りこぼさないよう、stdout / stderr が閉じるのを少し待つ
      await Promise.race([Promise.all([streamClosed(child.stdout), streamClosed(child.stderr)]), sleep(1000)]);
      let detail = spawnError?.message ?? overLimit;
      let reason: ExitReason;
      if (overLimit) reason = "limit";
      else if (stopRequested) reason = "stopped";
      else if (timedOut) reason = "timeout";
      else if (!watchdog) reason = code === 0 ? "ok" : "error";
      else if (l.addressSpace && (signal === "SIGABRT" || code === 134) && /memory allocation/.test(stderrTail)) {
        // RLIMIT_AS で確保に失敗すると "memory allocation of N bytes failed" を出して abort する
        // （exit 134 を error にしない。それ以外の abort は error のまま）
        reason = "limit";
        detail = `address space limit ${l.memoryMax} (${signal ?? `exit ${code}`})`;
      } else if (signal === "SIGKILL" && oomBefore !== undefined && ((await oomKillCount()) ?? 0) > oomBefore) {
        reason = "limit";
        detail = "cgroup oom_kill";
      } else reason = code === 0 ? "ok" : "error";
      resolve({ reason, code, signal, detail });
    };
    child.once("error", (e) => void finish(null, null, e));
    child.once("exit", (code, signal) => void finish(code, signal));
  });

  // exit を取りこぼさないよう、待ち受けを付けてから設定する
  if (watchdog && pid !== undefined) {
    // await しない（start の戻りを遅らせると、呼び出し側が onOutput を付ける前に出力が流れる）
    void fs.writeFile(`/proc/${pid}/oom_score_adj`, String(OOM_SCORE_ADJ)).catch(() => undefined);
  }

  return {
    id: `${spec.label}-${pid ?? "unstarted"}`,
    exited,
    async stop() {
      if (!done && pid !== undefined) {
        stopRequested = true;
        killGroup(pid, "SIGTERM");
        const t = setTimeout(() => killGroup(pid, "SIGKILL"), STOP_GRACE_MS);
        void exited.finally(() => clearTimeout(t));
      }
      return exited;
    },
    onOutput(cb) {
      outputCbs.push(cb);
    },
  };
}
