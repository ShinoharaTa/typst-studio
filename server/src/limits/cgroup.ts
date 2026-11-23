import fs from "node:fs/promises";
import path from "node:path";

// cgroup v2 の読み取り（watchdog ドライバの空きメモリと OOM kill の判定に使う）
const CGROUP_ROOT = "/sys/fs/cgroup";

async function readText(file: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(file, "utf8")).trim();
  } catch {
    return undefined;
  }
}

// 自プロセスの cgroup のディレクトリ。cgroup v2 でなければ undefined
export async function ownCgroupDir(): Promise<string | undefined> {
  const text = await readText("/proc/self/cgroup");
  const m = text && /^0::(\/.*)$/m.exec(text);
  return m ? path.join(CGROUP_ROOT, m[1]) : undefined;
}

// 自 cgroup から祖先へたどり、memory.max − memory.current の最小値（上限の無い階層は無視）
export async function cgroupAvailableBytes(): Promise<number | undefined> {
  let dir = await ownCgroupDir();
  let min: number | undefined;
  while (dir && dir.startsWith(CGROUP_ROOT + path.sep)) {
    const max = await readText(path.join(dir, "memory.max"));
    if (max !== undefined && max !== "max") {
      const cur = Number(await readText(path.join(dir, "memory.current")));
      if (Number.isFinite(cur)) {
        const avail = Math.max(0, Number(max) - cur);
        min = min === undefined ? avail : Math.min(min, avail);
      }
    }
    dir = path.dirname(dir);
  }
  return min;
}

// 自 cgroup の memory.events の oom_kill（読めなければ undefined）
export async function oomKillCount(): Promise<number | undefined> {
  const dir = await ownCgroupDir();
  const text = dir && (await readText(path.join(dir, "memory.events")));
  const m = text && /^oom_kill (\d+)$/m.exec(text);
  return m ? Number(m[1]) : undefined;
}
