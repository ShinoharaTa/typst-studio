import type { HostConfig } from "../config.js";
import type { ProcessLimitDriver } from "./driver.js";
import { NoneDriver } from "./none.js";
import { SystemdScopeDriver, systemdScopeAvailable } from "./systemd-scope.js";
import { WatchdogDriver } from "./watchdog.js";

// limits.driver から使うドライバを選ぶ。auto は systemd の user scope が使えれば systemd-scope、使えなければ watchdog
// stateDir: watchdog / none が起動中の子を記録する場所
export async function selectDriver(limits: HostConfig["limits"], stateDir: string): Promise<ProcessLimitDriver> {
  switch (limits.driver) {
    case "systemd-scope":
      return new SystemdScopeDriver();
    case "watchdog":
      return new WatchdogDriver(limits.watchdogIntervalMs, stateDir);
    case "none":
      return new NoneDriver(stateDir);
    case "auto":
      if (await systemdScopeAvailable()) return new SystemdScopeDriver();
      return new WatchdogDriver(limits.watchdogIntervalMs, stateDir);
  }
}
