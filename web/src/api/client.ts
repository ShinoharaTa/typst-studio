import type {
  BuildAccepted,
  BuildStatus,
  FileContent,
  ImageCall,
  ImageList,
  ImageSet,
  PreviewStatus,
  Profiles,
  ProjectSummary,
  UploadResult,
} from "./types";

// サーバーのエラー（{ error, ...extra }）
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// 保存時にディスク側の rev が変わっていた（409）。
// rev が null ならファイルが無くなった、content が null ならディスクの内容を読めない（2MB 超・UTF-8 でない）
export class ConflictError extends ApiError {
  constructor(
    message: string,
    readonly rev: string | null,
    readonly content: string | null,
    body: Record<string, unknown>,
  ) {
    super(409, message, body);
  }
}

// 空きメモリ不足でビルドできない（503 reason: "nomem"）
export class NoMemoryError extends ApiError {
  constructor(
    message: string,
    readonly available: number | undefined,
    readonly required: number | undefined,
    body: Record<string, unknown>,
  ) {
    super(503, message, body);
  }
}

const enc = encodeURIComponent;
const proj = (name: string) => `/api/projects/${enc(name)}`;

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers["content-type"] = body.type || "application/octet-stream";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: "same-origin", ...init });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const b = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
    const msg = typeof b.error === "string" ? b.error : `${res.status} ${res.statusText}`.trim();
    const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
    if (res.status === 409 && "rev" in b && strOrNull(b.rev) && strOrNull(b.content)) {
      throw new ConflictError(msg, b.rev, b.content, b);
    }
    if (res.status === 503 && b.reason === "nomem") {
      const n = (v: unknown) => (typeof v === "number" ? v : undefined);
      throw new NoMemoryError(msg, n(b.available), n(b.required), b);
    }
    throw new ApiError(res.status, msg, b);
  }
  return data as T;
}

export const api = {
  projects: () => request<ProjectSummary[]>("GET", "/api/projects"),
  articles: (name: string) => request<{ path: string }[]>("GET", `${proj(name)}/articles`),

  readFile: (name: string, path: string) => request<FileContent>("GET", `${proj(name)}/file?path=${enc(path)}`),
  // keepalive: ページを閉じても送り切る（ブラウザの上限 64KB に対し、UTF-8 で 60,000 バイト未満のときだけ付ける）
  writeFile: (name: string, path: string, content: string, baseRev: string | null, opts: { keepalive?: boolean } = {}) => {
    const body = { path, content, baseRev };
    const keepalive = opts.keepalive === true && new TextEncoder().encode(JSON.stringify(body)).length < 60_000;
    return request<{ rev: string }>("PUT", `${proj(name)}/file`, body, keepalive ? { keepalive } : {});
  },

  previewStart: (project: string, article: string) =>
    request<PreviewStatus>("POST", "/api/preview/start", { project, article }),
  previewStop: () => request<PreviewStatus>("POST", "/api/preview/stop", {}),
  previewStatus: () => request<PreviewStatus>("GET", "/api/preview/status"),
  previewMemory: (project: string, path: string, content: string) =>
    request<void>("POST", "/api/preview/memory", { project, path, content }),
  previewMemoryReset: (project: string, path: string) =>
    request<void>("POST", "/api/preview/memory/reset", { project, path }),
  // line / character は 0 始まり
  previewScroll: (project: string, path: string, line: number, character: number) =>
    request<void>("POST", "/api/preview/scroll", { project, path, line, character }),

  profiles: (name: string) => request<Profiles>("GET", `${proj(name)}/profiles`),
  buildStatus: (name: string, profile: string) =>
    request<BuildStatus>("GET", `${proj(name)}/build?profile=${enc(profile)}`),
  build: (name: string, profile: string, stopPreview = false) =>
    request<BuildStatus & { accepted?: BuildAccepted }>(
      "POST",
      `${proj(name)}/build`,
      stopPreview ? { profile, stopPreview: true } : { profile },
    ),

  images: (name: string, path: string) => request<ImageList>("GET", `${proj(name)}/images?path=${enc(path)}`),
  patchImage: (name: string, body: { path: string; baseRev: string; start: number; set: ImageSet }) =>
    request<{ rev: string; call: ImageCall }>("PATCH", `${proj(name)}/images`, body),
  previewImage: (name: string, body: { path: string; baseRev: string; start: number; set: ImageSet }) =>
    request<{ content: string; call: ImageCall }>("PATCH", `${proj(name)}/images`, { ...body, dryRun: true }),
  rawUrl: (name: string, path: string) => `${proj(name)}/raw?path=${enc(path)}`,
  upload: (name: string, article: string, file: File) =>
    request<UploadResult>("POST", `${proj(name)}/upload?article=${enc(article)}&name=${enc(file.name)}`, file),
};
