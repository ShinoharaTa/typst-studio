// プロセス制限ドライバ（spec 3.8.3）。studio のコードは重いプロセスをこのインターフェース越しに起動する。
// ローカルの PID を前提にしない（将来、別コンテナのランナーを 1 ドライバとして足せるように）

export type ExitReason = "ok" | "error" | "limit" | "timeout" | "stopped";

// 上限が「厳密」か「見張り」か「無し」か
export type LimitCapability = "strict" | "watchdog" | "none";

export interface ResourceLimits {
  memoryMax: string; // "600M" など
  swapMax?: string; // "0" で swap を使わせない
  cpuQuota?: string; // "200%"
  nice?: number;
  timeoutSeconds?: number;
}

export interface LaunchSpec {
  label: string; // ログと unit 名に使う短い名前（英数字と - だけ）
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  limits: ResourceLimits;
}

export interface ExitInfo {
  reason: ExitReason;
  code: number | null;
  signal: string | null;
  detail?: string;
}

export interface LimitedProcess {
  readonly id: string;
  readonly exited: Promise<ExitInfo>;
  // プロセス群ごと止める。終了まで待つ
  stop(): Promise<ExitInfo>;
  onOutput(cb: (stream: "stdout" | "stderr", chunk: Buffer) => void): void;
}

export interface ProcessLimitDriver {
  readonly name: string;
  readonly capability: LimitCapability;
  start(spec: LaunchSpec): Promise<LimitedProcess>;
  // ビルド開始前の判定に使う空きメモリ（バイト）
  availableMemoryBytes(): Promise<number>;
}
