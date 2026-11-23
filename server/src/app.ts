import Fastify, { type FastifyInstance } from "fastify";
import { ConfigError, type HostConfig } from "./config.js";
import type { ProcessLimitDriver } from "./limits/driver.js";
import { PreviewManager } from "./preview/manager.js";
import { fetchPreviewPage, rejectUpgrade, relayUpgrade } from "./preview/relay.js";

export interface App {
  app: FastifyInstance;
  preview: PreviewManager;
}

export function buildApp(host: HostConfig, driver: ProcessLimitDriver): App {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const preview = new PreviewManager(host, driver, app.log);

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

  // tinymist の HTML（データプレーンの /）を中継する
  app.get("/preview/", async (_req, reply) => {
    if (!preview.isRunning()) return reply.code(503).send({ error: "preview is not running" });
    const res = await fetchPreviewPage(preview.dataPlanePort);
    reply.code(res.statusCode ?? 502);
    const ct = res.headers["content-type"];
    if (ct) reply.header("content-type", ct);
    return reply.send(res);
  });

  // ルート / への WebSocket はデータプレーンへ中継する。studio 自身の WebSocket は /api/ws に置く（未実装）
  app.server.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/") return rejectUpgrade(socket, 404, "Not Found");
    if (!preview.isRunning()) return rejectUpgrade(socket, 503, "Service Unavailable");
    relayUpgrade(req, socket, head, preview.dataPlanePort, {
      onOpen: (s) => preview.viewerOpened(s),
      onClose: (s) => preview.viewerClosed(s),
    });
  });

  return { app, preview };
}
