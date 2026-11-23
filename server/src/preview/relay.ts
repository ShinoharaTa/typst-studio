import http from "node:http";
import type { Duplex } from "node:stream";

// tinymist のデータプレーンへの中継（spec 3.3.3）。
// tinymist は Origin が http://127.0.0.1 / http://localhost 以外の WebSocket を切るので、付け替えて渡す

export function upstreamOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

// ブラウザから来た upgrade リクエストのヘッダを、データプレーン向けに作り直す
// （Host と Origin を差し替え、Tailscale-User-* の識別ヘッダは渡さない）
export function rewriteUpgradeHeaders(rawHeaders: string[], port: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    if (name === "origin" || name === "host" || name.startsWith("tailscale-user-")) continue;
    out[name] = name in out ? `${out[name]}, ${rawHeaders[i + 1]}` : rawHeaders[i + 1];
  }
  out.host = `127.0.0.1:${port}`;
  out.origin = upstreamOrigin(port);
  return out;
}

// GET /preview/ → データプレーンの / （tinymist の HTML）
export function fetchPreviewPage(port: number): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/" }, resolve);
    req.on("error", reject);
  });
}

export interface RelayHooks {
  onOpen(client: Duplex): void;
  onClose(client: Duplex): void;
}

export function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

// ブラウザ ⇄ studio の socket を、データプレーンへの upgrade 接続とつなぐ。フレームは解かずにバイトのまま流す
export function relayUpgrade(
  req: http.IncomingMessage,
  client: Duplex,
  head: Buffer,
  port: number,
  hooks: RelayHooks,
): void {
  const upReq = http.request({
    host: "127.0.0.1",
    port,
    path: req.url ?? "/",
    method: "GET",
    headers: rewriteUpgradeHeaders(req.rawHeaders, port),
  });

  const onClientError = () => upReq.destroy();
  client.on("error", onClientError);

  upReq.on("upgrade", (res, upstream, upHead) => {
    client.off("error", onClientError);
    let resp = `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n`;
    for (let i = 0; i < res.rawHeaders.length; i += 2) resp += `${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}\r\n`;
    client.write(resp + "\r\n");
    if (upHead.length) client.write(upHead);
    if (head.length) upstream.write(head);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      upstream.destroy();
      client.destroy();
      hooks.onClose(client);
    };
    upstream.on("error", close);
    client.on("error", close);
    upstream.on("close", close);
    client.on("close", close);
    upstream.pipe(client);
    client.pipe(upstream);
    hooks.onOpen(client);
  });
  upReq.on("response", (res) => {
    res.resume();
    rejectUpgrade(client, res.statusCode ?? 502, res.statusMessage ?? "Bad Gateway");
  });
  upReq.on("error", () => rejectUpgrade(client, 502, "Bad Gateway"));
  upReq.end();
}
