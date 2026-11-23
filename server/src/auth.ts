import type { IncomingHttpHeaders } from "node:http";
import type { HostConfig } from "./config.js";

// 認証（spec 7.2）と、状態を変える API の Origin 検査（spec 7.3）

// ヘッダ無しでも通すパス（同一ホストからの直接アクセス）
const HEADERLESS_PATHS = new Set(["/mcp", "/healthz"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const LOGIN_HEADER = "tailscale-user-login";

export type AccessDecision = { ok: true } | { ok: false; status: 400 | 401 | 403; error: string };

export interface AccessRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  // WebSocket の upgrade。GET でも Origin を検査する
  upgrade?: boolean;
}

function header(h: IncomingHttpHeaders, name: string): string | undefined {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
}

export function checkAccess(host: HostConfig, req: AccessRequest): AccessDecision {
  // 判定は正規化前の生パス（? より前）で行う。Fastify は .. や %2e を畳まないので、
  // 正規化すると食い違うリクエスト（/x/../healthz、//x/healthz、絶対形式など）は受け付けない
  const rawPath = req.url.split("?")[0];
  let normalized: string | undefined;
  try {
    normalized = new URL(req.url, "http://localhost").pathname;
  } catch {
    normalized = undefined;
  }
  if (!rawPath.startsWith("/") || rawPath.startsWith("//") || normalized !== rawPath) {
    return { ok: false, status: 400, error: "malformed request path" };
  }
  const headerless = HEADERLESS_PATHS.has(rawPath);

  if (host.auth.mode === "tailscale") {
    const login = header(req.headers, LOGIN_HEADER);
    if (login !== undefined) {
      if (!host.auth.allowUsers.includes(login)) return { ok: false, status: 403, error: "user is not allowed" };
    } else if (!headerless) {
      return { ok: false, status: 401, error: "authentication required" };
    }
  }

  if (req.upgrade) {
    // 第三者のページから中継に繋がせない。中継は Origin を付け替えるので、tinymist 側の検査は効かない
    const origin = header(req.headers, "origin");
    if (origin !== undefined) {
      if (!host.server.allowedOrigins.includes(origin)) return { ok: false, status: 403, error: "origin is not allowed" };
    } else if (host.auth.mode !== "none") {
      return { ok: false, status: 403, error: "origin is required" };
    }
  } else if (!SAFE_METHODS.has(req.method.toUpperCase())) {
    const origin = header(req.headers, "origin");
    if (origin !== undefined) {
      if (!host.server.allowedOrigins.includes(origin)) return { ok: false, status: 403, error: "origin is not allowed" };
    } else if (host.auth.mode !== "none" && !headerless) {
      // Origin の無い状態変更は、開発用の auth.mode = "none"（curl）と /mcp・/healthz だけ許す
      return { ok: false, status: 403, error: "origin is required" };
    }
  }

  return { ok: true };
}
