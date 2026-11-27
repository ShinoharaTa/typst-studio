// API の型（サーバーの取り決めに合わせて画面側で定義する）

export interface ProjectSummary {
  name: string;
  branch: string | null;
  detached: boolean | null;
  head: string | null;
  uncommitted: number | null;
  unpushed: number | null;
  upstream: string | null;
  gitError?: string;
  error?: string;
}

export interface FileContent {
  path: string;
  content: string;
  rev: string;
}

export type PreviewState = "stopped" | "starting" | "running" | "stopping";

export interface PreviewStatus {
  state: PreviewState;
  project: string | null;
  article: string | null;
  startedAt: string | null;
  viewers: number;
  lastError: string | null;
}

// 0 始まり
export interface Position {
  line: number;
  character: number;
}

export interface ImageCall {
  path: string;
  // 呼び出し全体の文字オフセット [start, end)
  start: number;
  end: number;
  // 1 始まり
  line: number;
  column: number;
  src: string | null;
  resolved: string | null;
  editable: boolean;
  width: string | null;
  height: string | null;
  alt: string | null;
  nearest?: boolean;
}

export interface ImageList {
  rev: string;
  calls: ImageCall[];
}

export interface ImageSet {
  width?: string | null;
  height?: string | null;
  alt?: string | null;
}

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
  reason: "ok" | "error" | "limit" | "timeout" | "stopped" | "nomem";
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

export interface Profiles {
  profiles: string[];
  default: string;
}

export interface UploadResult {
  path: string;
  insert: string;
}

type GitFields = Omit<ProjectSummary, "name" | "error">;

// /api/ws の通知
export type StudioEvent =
  | { type: "file-changed"; project: string; path: string; rev: string }
  | { type: "file-removed"; project: string; path: string }
  | ({ type: "git-changed"; project: string } & GitFields)
  | { type: "articles-changed"; project: string }
  | { type: "config-changed"; project: string; error?: string }
  | ({ type: "build-status" } & BuildStatus)
  | { type: "preview-jump"; project: string; path: string; start: Position; end: Position; image?: ImageCall }
  | ({ type: "preview-status" } & PreviewStatus)
  | { type: "preview-compile"; project: string; ok: boolean; message?: string };
