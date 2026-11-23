import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { relayUpgrade, rewriteUpgradeHeaders } from "../src/preview/relay.js";

describe("rewriteUpgradeHeaders", () => {
  it("replaces Origin and Host with the loopback data plane", () => {
    const h = rewriteUpgradeHeaders(
      [
        "Host", "studio.example.test",
        "Origin", "https://studio.example.test",
        "Upgrade", "websocket",
        "Connection", "Upgrade",
        "Sec-WebSocket-Key", "abc",
        "Sec-WebSocket-Version", "13",
      ],
      23625,
    );
    expect(h.origin).toBe("http://127.0.0.1:23625");
    expect(h.host).toBe("127.0.0.1:23625");
    expect(h.upgrade).toBe("websocket");
    expect(h["sec-websocket-key"]).toBe("abc");
  });

  it("adds Origin when the client sent none", () => {
    expect(rewriteUpgradeHeaders(["Host", "x"], 1234).origin).toBe("http://127.0.0.1:1234");
  });
});

describe("relayUpgrade", () => {
  const closers: (() => void)[] = [];
  afterEach(() => closers.splice(0).forEach((c) => c()));

  it("passes a tailnet Origin through an upstream that only accepts loopback Origin", async () => {
    // tinymist の Origin 検査を模した上流
    const upstream = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      verifyClient: (info: { origin: string }) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(info.origin),
    });
    await new Promise((r) => upstream.once("listening", r));
    const upPort = (upstream.address() as AddressInfo).port;
    upstream.on("connection", (ws, req) => ws.send(`origin=${req.headers.origin} path=${req.url}`));
    closers.push(() => upstream.close());

    let opened = 0;
    let closed = 0;
    const front = http.createServer();
    front.on("upgrade", (req, socket, head) =>
      relayUpgrade(req, socket, head, upPort, { onOpen: () => opened++, onClose: () => closed++ }),
    );
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
    const frontPort = (front.address() as AddressInfo).port;
    closers.push(() => front.close());

    const origin = "https://studio.example.test";
    // 直接だと切られる
    await expect(
      new Promise((res, rej) => {
        const ws = new WebSocket(`ws://127.0.0.1:${upPort}/`, { origin });
        ws.once("open", res);
        ws.once("error", rej);
      }),
    ).rejects.toThrow();

    // 中継越しだと通り、上流には付け替えた Origin が届く
    const ws = new WebSocket(`ws://127.0.0.1:${frontPort}/other/path?x=1`, { origin });
    const msg = await new Promise<string>((res, rej) => {
      ws.once("message", (d) => res(d.toString()));
      ws.once("error", rej);
    });
    // 上流へのパスは / に固定し、クエリだけ渡す
    expect(msg).toBe(`origin=http://127.0.0.1:${upPort} path=/?x=1`);
    expect(opened).toBe(1);
    ws.close();
    await new Promise((r) => ws.once("close", r));
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(1);
  });
});
