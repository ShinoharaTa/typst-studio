import type { HostConfig } from "../config.js";
import type { ProcessLimitDriver } from "./driver.js";
import { SystemdScopeDriver, systemdScopeAvailable } from "./systemd-scope.js";

// limits.driver から使うドライバを選ぶ。今は systemd-scope だけ実装している（watchdog / none は後の作業）
export async function selectDriver(limits: HostConfig["limits"]): Promise<ProcessLimitDriver> {
  switch (limits.driver) {
    case "systemd-scope":
      return new SystemdScopeDriver();
    case "auto":
      if (await systemdScopeAvailable()) return new SystemdScopeDriver();
      throw new Error('limits.driver = "auto": systemd user scope is unavailable and "watchdog" is not implemented yet');
    default:
      throw new Error(`limits.driver = "${limits.driver}" is not implemented yet`);
  }
}
