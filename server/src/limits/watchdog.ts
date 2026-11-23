import { cgroupAvailableBytes } from "./cgroup.js";
import type { LaunchSpec, LimitedProcess, ProcessLimitDriver } from "./driver.js";
import { startLocal } from "./local.js";
import { memAvailableBytes } from "./meminfo.js";

// watchdog ドライバ（spec 3.8.2 の P2）。RSS の見張り + typst のみ prlimit --as。
// swap / CPU はコンテナ全体の設定に委ねる。nice と oom_score_adj は付ける
export class WatchdogDriver implements ProcessLimitDriver {
  readonly name = "watchdog";
  readonly capability = "watchdog" as const;

  constructor(private intervalMs: number) {}

  async availableMemoryBytes(): Promise<number> {
    const mem = await memAvailableBytes();
    const cg = await cgroupAvailableBytes();
    return cg === undefined ? mem : Math.min(mem, cg);
  }

  start(spec: LaunchSpec): Promise<LimitedProcess> {
    return startLocal(spec, { mode: { kind: "watchdog", intervalMs: this.intervalMs } });
  }
}
