import type { LaunchSpec, LimitedProcess, ProcessLimitDriver } from "./driver.js";
import { startLocal } from "./local.js";
import { memAvailableBytes } from "./meminfo.js";

// none ドライバ（開発・テスト用）。上限を掛けず、limit の判定もしない
export class NoneDriver implements ProcessLimitDriver {
  readonly name = "none";
  readonly capability = "none" as const;

  availableMemoryBytes(): Promise<number> {
    return memAvailableBytes();
  }

  start(spec: LaunchSpec): Promise<LimitedProcess> {
    return startLocal(spec, { mode: { kind: "none" } });
  }
}
