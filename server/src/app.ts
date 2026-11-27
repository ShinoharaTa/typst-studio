import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { WebSocketServer } from "ws";
import { checkAccess } from "./auth.js";
import { BUILD_FILE_RE, BuildError, BuildManager, parseRange } from "./build.js";
import { ConfigError, loadProjectConfig, PROJECT_NAME_RE, type HostConfig } from "./config.js";
import {
  checkRelPath,
  FileError,
  listArticles,
  MAX_FILE_BYTES,
  projectRoot,
  readProjectFile,
  resolveExistingFile,
  writeProjectFile,
} from "./files.js";
import { listImages, MAX_UPLOAD_BYTES, patchImage, rawType, uploadImage } from "./images.js";
import type { ProcessLimitDriver } from "./limits/driver.js";
import { checkArticle, PreviewError, PreviewManager } from "./preview/manager.js";
import { fetchPreviewPage, rejectUpgrade, relayUpgrade } from "./preview/relay.js";
import { EMPTY_GIT, gitState, Watchers, type WatchersOptions } from "./watch.js";

export interface App {
  app: FastifyInstance;
  preview: PreviewManager;
  watchers: Watchers;
  build: BuildManager;
}

const STATUS_TEXT = { 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden" } as const;

export function buildApp(host: HostConfig, driver: ProcessLimitDriver, opts: { ws?: WatchersOptions } = {}): App {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  const watchers = new Watchers(host, app.log, opts.ws);
  const preview = new PreviewManager(host, driver, app.log, (ev) => watchers.broadcast(ev));
  const build = new BuildManager(host, driver, app.log, (st) => watchers.broadcast({ type: "build-status", ...st }));
  watchers.onEvent((ev) => {
    if (ev.type === "file-changed" || ev.type === "file-removed" || ev.type === "git-changed") build.invalidate(ev.project);
  });
  // /api/ws（studio 自身の通知）。upgrade は下の app.server.on("upgrade") で振り分ける
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  // onClose は server.close() の完了後に走るので、upgrade 済みの /api/ws はその前（preClose）に切る
  app.addHook("preClose", async () => {
    // 応答中の接続が残っていても typst を止める（onClose は server.close() の完了まで走らない）
    await build.close();
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

  // FileError / BuildError / PreviewError / ConfigError を HTTP のエラーにする。それ以外は投げ直す
  const sendError = (reply: FastifyReply, e: unknown) => {
    if (e instanceof FileError || e instanceof BuildError) return reply.code(e.status).send({ error: e.message, ...e.extra });
    if (e instanceof PreviewError) return reply.code(e.status).send({ error: e.message });
    if (e instanceof ConfigError) return reply.code(400).send({ error: e.message });
    throw e;
  };

  // 記事プレビューの制御（tinymist の制御プレーンへの中継。spec 4.7）
  app.post<{ Body: { project?: unknown; path?: unknown; content?: unknown } }>(
    "/api/preview/memory",
    { bodyLimit: MAX_FILE_BYTES * 6 + 64 * 1024 },
    async (req, reply) => {
      try {
        const b = req.body ?? {};
        preview.updateMemory(b.project, b.path, b.content);
        return reply.code(204).send();
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.post<{ Body: { project?: unknown; path?: unknown } }>("/api/preview/memory/reset", async (req, reply) => {
    try {
      const b = req.body ?? {};
      preview.resetMemory(b.project, b.path);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post<{ Body: { project?: unknown; path?: unknown; line?: unknown; character?: unknown } }>("/api/preview/scroll", async (req, reply) => {
    try {
      const b = req.body ?? {};
      preview.scrollTo(b.project, b.path, b.line, b.character);
      return reply.code(204).send();
    } catch (e) {
      return sendError(reply, e);
    }
  });

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

  // 本全体ビルド（spec 3.3.4 / 4.6）
  app.get<{ Params: { name: string } }>("/api/projects/:name/profiles", async (req, reply) => {
    try {
      projectRoot(host, req.params.name);
      const project = loadProjectConfig(host, req.params.name);
      return { profiles: Object.keys(project.profiles), default: BuildManager.defaultProfile(project) };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post<{ Params: { name: string }; Body: { profile?: unknown; stopPreview?: unknown } | undefined }>(
    "/api/projects/:name/build",
    async (req, reply) => {
      try {
        projectRoot(host, req.params.name);
        const { profile, stopPreview } = req.body ?? {};
        if (stopPreview !== undefined && typeof stopPreview !== "boolean") throw new BuildError(400, '"stopPreview" must be a boolean');
        // プレビューは、プロファイルの検査を通って実際にビルドを始めるときだけ止める
        const r = await build.request(req.params.name, profile, stopPreview ? () => preview.stop("build") : undefined);
        return reply.code(202).send({ ...r.status, accepted: r.accepted });
      } catch (e) {
        return sendError(reply, e);
      }
    },
  );

  app.get<{ Params: { name: string }; Querystring: { profile?: unknown } }>("/api/projects/:name/build", async (req, reply) => {
    try {
      projectRoot(host, req.params.name);
      return await build.statusFor(req.params.name, req.query.profile);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // ビルドした PDF。ファイル名に buildId が入るので、内容は変わらない
  app.get<{ Params: { name: string; file: string } }>("/api/projects/:name/builds/:file", async (req, reply) => {
    const { name, file } = req.params;
    const m = BUILD_FILE_RE.exec(file);
    const fh = PROJECT_NAME_RE.test(name) && m ? await fs.promises.open(path.join(build.buildsDir, name, file)).catch(() => null) : null;
    const st = await fh?.stat();
    if (!fh || !st?.isFile()) {
      await fh?.close();
      return reply.code(404).send({ error: `build "${file}" not found` });
    }
    const size = st.size;
    reply.header("accept-ranges", "bytes");
    const range = parseRange(req.headers.range, size);
    if (range === "unsatisfiable") {
      await fh.close();
      return reply.code(416).header("content-range", `bytes */${size}`).send({ error: "range not satisfiable" });
    }
    reply.header("cache-control", "private, max-age=31536000, immutable").type("application/pdf");
    // ダウンロード時の名前はプロファイルの output
    try {
      const output = loadProjectConfig(host, name).profiles[m![1]]?.output;
      if (output) reply.header("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(path.posix.basename(output))}`);
    } catch {
      // 設定が読めなくても PDF は返す
    }
    if (range) {
      reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${size}`).header("content-length", range.end - range.start + 1);
      return reply.send(fh.createReadStream({ start: range.start, end: range.end }));
    }
    reply.header("content-length", size);
    return reply.send(fh.createReadStream());
  });

  // 画像（spec 4.4 / 4.5）
  app.get<{ Params: { name: string }; Querystring: { path?: unknown } }>("/api/projects/:name/images", async (req, reply) => {
    try {
      return listImages(projectRoot(host, req.params.name), req.query.path);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.patch<{ Params: { name: string }; Body: Record<string, unknown> | undefined }>("/api/projects/:name/images", async (req, reply) => {
    try {
      return await patchImage(projectRoot(host, req.params.name), req.body ?? {});
    } catch (e) {
      return sendError(reply, e);
    }
  });

  // リポジトリ内の画像・PDF をそのまま返す（サムネイル用）
  app.get<{ Params: { name: string }; Querystring: { path?: unknown } }>("/api/projects/:name/raw", async (req, reply) => {
    let fh: fs.promises.FileHandle | undefined;
    try {
      const root = projectRoot(host, req.params.name);
      const rel = checkRelPath(req.query.path);
      const type = rawType(rel);
      const f = resolveExistingFile(root, rel);
      fh = await fs.promises.open(f.real);
      const st = await fh.stat();
      reply.type(type).header("content-length", st.size).header("cache-control", "no-cache").header("x-content-type-options", "nosniff");
      // SVG の中のスクリプトを動かさない
      if (type === "image/svg+xml") reply.header("content-security-policy", "sandbox");
      return reply.send(fh.createReadStream());
    } catch (e) {
      await fh?.close();
      return sendError(reply, e);
    }
  });

  // 本文はファイルの中身そのもの（Content-Type は問わない）
  app.register(async (scope) => {
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
    scope.post<{ Params: { name: string }; Querystring: { article?: unknown; name?: unknown } }>(
      "/api/projects/:name/upload",
      { bodyLimit: MAX_UPLOAD_BYTES },
      async (req, reply) => {
        try {
          projectRoot(host, req.params.name);
          const project = loadProjectConfig(host, req.params.name);
          const { article } = req.query;
          if (typeof article !== "string" || article === "") throw new FileError(400, '"article" (query) is required');
          checkArticle(project, checkRelPath(article));
          return reply.code(201).send(await uploadImage(project, article, req.query.name, req.body));
        } catch (e) {
          return sendError(reply, e);
        }
      },
    );
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

  return { app, preview, watchers, build };
}
