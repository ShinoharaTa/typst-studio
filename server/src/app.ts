import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { WebSocketServer } from "ws";
import { checkAccess } from "./auth.js";
import { ConfigError, loadProjectConfig, type HostConfig } from "./config.js";
import { FileError, listArticles, MAX_FILE_BYTES, projectRoot, readProjectFile, writeProjectFile } from "./files.js";
import type { ProcessLimitDriver } from "./limits/driver.js";
import { PreviewManager } from "./preview/manager.js";
import { fetchPreviewPage, rejectUpgrade, relayUpgrade } from "./preview/relay.js";
import { gitState, Watchers } from "./watch.js";

export interface App {
  app: FastifyInstance;
  preview: PreviewManager;
  watchers: Watchers;
}

const STATUS_TEXT = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden" } as const;

export function buildApp(host: HostConfig, driver: ProcessLimitDriver): App {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const preview = new PreviewManager(host, driver, app.log);
  const watchers = new Watchers(host, app.log);
  // /api/ws（studio 自身の通知）。upgrade は下の app.server.on("upgrade") で振り分ける
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
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
        const root = projectRoot(host, name);
        void watchers.ensure(name, root).catch(() => undefined);
        let error: string | undefined;
        try {
          loadProjectConfig(host, name);
        } catch (e) {
          error = (e as Error).message;
        }
        return { name, ...(await gitState(root)), ...(error === undefined ? {} : { error }) };
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
      const f = readProjectFile(projectRoot(host, req.params.name), req.query.path);
      watchers.noteRev(req.params.name, f.path, f.rev);
      return f;
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

  // ルート / への WebSocket はデータプレーンへ中継する。studio 自身の WebSocket は /api/ws
  app.server.on("upgrade", (req, socket, head) => {
    const d = checkAccess(host, { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, upgrade: true });
    if (!d.ok) return rejectUpgrade(socket, d.status, STATUS_TEXT[d.status]);
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api/ws") {
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
