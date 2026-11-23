import type { HostConfig } from "../config.js";
import type { ProcessLimitDriver } from "./driver.js";
import { NoneDriver } from "./none.js";
import { SystemdScopeDriver, systemdScopeAvailable } from "./systemd-scope.js";
import { WatchdogDriver } from "./watchdog.js";

// limits.driver から使うドライバを選ぶ。auto は systemd の user scope が使えれば systemd-scope、使えなければ watchdog
export async function selectDriver(limits: HostConfig["limits"]): Promise<ProcessLimitDriver> {
  switch (limits.driver) {
    case "systemd-scope":
      return new SystemdScopeDriver();
    case "watchdog":
      return new WatchdogDriver(limits.watchdogIntervalMs);
    case "none":
      return new NoneDriver();
    case "auto":
      if (await systemdScopeAvailable()) return new SystemdScopeDriver();
      return new WatchdogDriver(limits.watchdogIntervalMs);
  }
}
