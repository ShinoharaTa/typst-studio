import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import type { ExitInfo, LaunchSpec, LimitedProcess, ProcessLimitDriver } from "./driver.js";
import { memAvailableBytes } from "./meminfo.js";

// systemd-scope ドライバ。studio の中で systemd-run / systemctl を呼ぶのはこのファイルだけ（spec 3.8.4）
const execFileP = promisify(execFile);

async function systemctl(args: string[]): Promise<string> {
  const { stdout } = await execFileP("systemctl", ["--user", ...args]);
  return stdout.trim();
}

async function scopeResult(unit: string): Promise<string> {
  try {
    return await systemctl(["show", unit, "-p", "Result", "--value"]);
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// systemd-run --user --scope が使えるか（limits.driver = "auto" の選択に使う）
export async function systemdScopeAvailable(): Promise<boolean> {
  try {
    await execFileP("systemd-run", ["--user", "--scope", "--quiet", "--", "true"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export class SystemdScopeDriver implements ProcessLimitDriver {
  readonly name = "systemd-scope";
  readonly capability = "strict" as const;

  availableMemoryBytes(): Promise<number> {
    return memAvailableBytes();
  }

  async start(spec: LaunchSpec): Promise<LimitedProcess> {
    const unit = `typst-studio-${spec.label}-${randomBytes(4).toString("hex")}.scope`;
    const l = spec.limits;
    const args = ["--user", "--scope", "--quiet", `--unit=${unit}`, "-p", `MemoryMax=${l.memoryMax}`];
    if (l.swapMax !== undefined) args.push("-p", `MemorySwapMax=${l.swapMax}`);
    if (l.cpuQuota !== undefined) args.push("-p", `CPUQuota=${l.cpuQuota}`);
    if (l.nice !== undefined) args.push(`--nice=${l.nice}`);
    args.push("--", spec.command, ...spec.args);

    const child = spawn("systemd-run", args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stopRequested = false;
    let timedOut = false;
    const outputCbs: ((s: "stdout" | "stderr", c: Buffer) => void)[] = [];
    child.stdout.on("data", (c: Buffer) => outputCbs.forEach((cb) => cb("stdout", c)));
    child.stderr.on("data", (c: Buffer) => outputCbs.forEach((cb) => cb("stderr", c)));

    const stopUnit = async () => {
      try {
        await systemctl(["stop", unit]);
      } catch {
        // 既に終わっている
      }
    };

    const timer =
      l.timeoutSeconds !== undefined
        ? setTimeout(() => {
            timedOut = true;
            void stopUnit();
          }, l.timeoutSeconds * 1000)
        : undefined;

    const exited = new Promise<ExitInfo>((resolve) => {
      let done = false;
      const finish = async (code: number | null, signal: string | null, spawnError?: Error) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        let result = await scopeResult(unit);
        // OOM kill は子の終了より scope の結果の反映が遅れることがある
        for (let i = 0; i < 5 && signal === "SIGKILL" && result !== "oom-kill" && !stopRequested; i++) {
          await sleep(200);
          result = await scopeResult(unit);
        }
        if (result && result !== "success") {
          try {
            await systemctl(["reset-failed", unit]);
          } catch {
            // 既に回収済み
          }
        }
        let reason: ExitInfo["reason"];
        if (stopRequested) reason = "stopped";
        else if (timedOut) reason = "timeout";
        else if (result === "oom-kill") reason = "limit";
        else if (code === 0) reason = "ok";
        else reason = "error";
        resolve({ reason, code, signal, detail: spawnError?.message ?? (result ? `scope result: ${result}` : undefined) });
      };
      child.once("error", (e) => void finish(null, null, e));
      child.once("exit", (code, signal) => void finish(code, signal));
    });

    return {
      id: unit,
      exited,
      async stop() {
        stopRequested = true;
        await stopUnit();
        return exited;
      },
      onOutput(cb) {
        outputCbs.push(cb);
      },
    };
  }
}
