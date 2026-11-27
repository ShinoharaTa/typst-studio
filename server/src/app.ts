import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { WebSocketServer } from "ws";
import { checkAccess } from "./auth.js";
import { ConfigError, loadProjectConfig, type HostConfig } from "./config.js";
import { FileError, listArticles, MAX_FILE_BYTES, projectRoot, readProjectFile, writeProjectFile } from "./files.js";
import type { ProcessLimitDriver } from "./limits/driver.js";
import { PreviewManager } from "./preview/manager.js";
import { fetchPreviewPage, rejectUpgrade, relayUpgrade } from "./preview/relay.js";
import { EMPTY_GIT, gitState, Watchers, type WatchersOptions } from "./watch.js";

export interface App {
  app: FastifyInstance;
  preview: PreviewManager;
  watchers: Watchers;
}

const STATUS_TEXT = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden" } as const;

// 画面（web/ を Vite でビルドしたもの）。server/dist/app.js からも server/src/app.ts からも同じ場所
export const DEFAULT_WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
// 画面の SPA フォールバックを返さないパス
const NON_SPA_PREFIXES = ["/api", "/preview", "/healthz"];

function isSpaPath(pathname: string): boolean {
  return !NON_SPA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface BuildAppOptions {
  ws?: WatchersOptions;
  // 画面の置き場所。null で配信しない
  webDist?: string | null;
}

export function buildApp(host: HostConfig, driver: ProcessLimitDriver, opts: BuildAppOptions = {}): App {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const preview = new PreviewManager(host, driver, app.log);
  const watchers = new Watchers(host, app.log, opts.ws);
  // /api/ws（studio 自身の通知）。upgrade は下の app.server.on("upgrade") で振り分ける
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  // onClose は server.close() の完了後に走るので、upgrade 済みの /api/ws はその前（preClose）に切る
  app.addHook("preClose", async () => {
    watchers.closeClients();
  });
  app.addHook("onClose", async () => {
    await watchers.close();
    wss.close();
  });

  app.addHook("onRequest", async (req, reply) => {
    const d = checkAccess(host, { method: req.method, url: req.url, headers: req.headers });
    if (!d.ok) return reply.code(d.status).send({ error: d.error });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post<{ Body: { project?: unknown; article?: unknown } }>("/api/preview/start", async (req, reply) => {
    const { project, article } = req.body ?? {};
    if (typeof project !== "string" || typeof article !== "string") {
      return reply.code(400).send({ error: '"project" and "article" (strings) are required' });
    }
    try {
      await preview.start(project, article);
    } catch (e) {
      const code = e instanceof ConfigError ? 400 : 500;
      return reply.code(code).send({ error: (e as Error).message, status: preview.status() });
    }
    return preview.status();
  });

  app.get("/api/preview/status", async () => preview.status());

  app.post("/api/preview/stop", async () => {
    await preview.stop("api");
    return preview.status();
  });

  // FileError / ConfigError を HTTP のエラーにする。それ以外は投げ直す
  const sendError = (reply: FastifyReply, e: unknown) => {
    if (e instanceof FileError) return reply.code(e.status).send({ error: e.message, ...e.extra });
    if (e instanceof ConfigError) return reply.code(400).send({ error: e.message });
    throw e;
  };

  app.get("/api/projects", async () => {
    const names = watchers.listProjectNames();
    return Promise.all(
      names.map(async (name) => {
        let root: string;
        try {
          root = projectRoot(host, name);
        } catch (e) {
          // 一覧を取ってから消えた・読めないプロジェクト
          return { name, ...EMPTY_GIT, error: (e as Error).message };
        }
        let error: string | undefined;
        try {
          loadProjectConfig(host, name);
        } catch (e) {
          error = (e as Error).message;
        }
        // 監視が持つ最新の Git 状態を使う。監視を始められなければその場で読む
        const git = await watchers.ensure(name, root).then(
          (pw) => pw.currentGit(),
          () => gitState(root),
        );
        return { name, ...git, ...(error === undefined ? {} : { error }) };
      }),
    );
  });

  app.get<{ Params: { name: string } }>("/api/projects/:name/articles", async (req, reply) => {
    try {
      projectRoot(host, req.params.name);
      return await listArticles(loadProjectConfig(host, req.params.name));
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get<{ Params: { name: string }; Querystring: { path?: unknown } }>("/api/projects/:name/file", async (req, reply) => {
    try {
      return readProjectFile(projectRoot(host, req.params.name), req.query.path);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.put<{ Params: { name: string }; Body: { path?: unknown; content?: unknown; baseRev?: unknown } }>(
    "/api/projects/:name/file",
    // JSON のエスケープで膨らむ分を見込む（内容そのものの上限は MAX_FILE_BYTES で別に検査する）
    { bodyLimit: MAX_FILE_BYTES * 6 + 64 * 1024 },
    async (req, reply) => {
      try {
        return await writeProjectFile(projectRoot(host, req.params.name), req.body ?? {});
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  // tinymist の HTML（データプレーンの /）を中継する
  app.get("/preview/", async (_req, reply) => {
    if (!preview.isRunning()) return reply.code(503).send({ error: "preview is not running" });
    const res = await fetchPreviewPage(preview.dataPlanePort);
    reply.code(res.statusCode ?? 502);
    const ct = res.headers["content-type"];
    if (ct) reply.header("content-type", ct);
    return reply.send(res);
  });

  // 画面の配信（/ と /assets/*）。/api /preview /healthz 以外の GET は index.html を返す（SPA）
  const webDist = opts.webDist === undefined ? DEFAULT_WEB_DIST : opts.webDist;
  const hasWeb = webDist !== null && fs.existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      index: "index.html",
      // 名前にハッシュの付いた assets/ は変わらないので長く持たせる。index.html は毎回確かめさせる
      cacheControl: false,
      setHeaders: (reply, file) => {
        const rel = path.relative(webDist, file).split(path.sep).join("/");
        reply.header("cache-control", rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  } else if (webDist !== null) {
    app.log.warn({ webDist }, "web UI is not built (run npm run build); / is not served");
  }
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split("?")[0];
    if (hasWeb && (req.method === "GET" || req.method === "HEAD") && isSpaPath(pathname)) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not Found", message: `Route ${req.method}:${pathname} not found`, statusCode: 404 });
  });

  // ルート / への WebSocket はデータプレーンへ中継する。studio 自身の WebSocket は /api/ws
  app.server.on("upgrade", (req, socket, head) => {
    const d = checkAccess(host, { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, upgrade: true });
    if (!d.ok) return rejectUpgrade(socket, d.status, STATUS_TEXT[d.status]);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/ws") {
      if (!watchers.canAccept()) return rejectUpgrade(socket, 503, "Service Unavailable");
      return wss.handleUpgrade(req, socket, head, (ws) => watchers.addClient(ws));
    }
    if (pathname !== "/") return rejectUpgrade(socket, 404, "Not Found");
    if (!preview.isRunning()) return rejectUpgrade(socket, 503, "Service Unavailable");
    relayUpgrade(req, socket, head, preview.dataPlanePort, {
      onOpen: (s) => preview.viewerOpened(s),
      onClose: (s) => preview.viewerClosed(s),
    });
  });

  return { app, preview, watchers };
}
